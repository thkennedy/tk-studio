"""Tests for the trial meter (ST-24.1): copy-out, pricing, timing, one observation.

Inline fixtures only -- a tempdir run dir (events, journal, state, transcripts
in a fake `~/.claude/projects`), a fixture price table, and `TK_STUDIO_HOME`
isolation for the ledger. No real transcripts.
"""
from __future__ import annotations

import io
import json
import os
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import ledger  # noqa: E402
import meter  # noqa: E402

KEY = "9-1-a-story"
OTHER = "9-2-another-story"

FIXTURE_PRICES = {
    "date": "2000-01-01",
    "source": "fixture",
    "aliases": {"model-a-alias": "model-a"},
    "models": {
        "model-a": {"input": 1.0, "output": 2.0, "cache_write_5m": 3.0,
                    "cache_write_1h": 4.0, "cache_read": 5.0, "derived": []},
        "model-b": {"input": 10.0, "output": 20.0, "cache_write_5m": 30.0,
                    "cache_write_1h": 40.0, "cache_read": 50.0, "derived": []},
    },
}
M = 1_000_000


def usage_line(mid, model, inp=0, out=0, cw5=0, cw1=0, cr=0, split=True):
    usage = {"input_tokens": inp, "output_tokens": out,
             "cache_read_input_tokens": cr,
             "cache_creation_input_tokens": cw5 + cw1}
    if split:
        usage["cache_creation"] = {"ephemeral_5m_input_tokens": cw5,
                                   "ephemeral_1h_input_tokens": cw1}
    return {"type": "assistant",
            "message": {"id": mid, "model": model, "usage": usage}}


class MeterTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        self._old_home = os.environ.get("TK_STUDIO_HOME")
        os.environ["TK_STUDIO_HOME"] = str(self.tmp / "store")
        self.repo = self.tmp / "repo"
        self.run_dir = self.repo / ".bmad-loop" / "runs" / "20000101-000000-1"
        (self.run_dir / "events").mkdir(parents=True)
        self.projects = self.tmp / "claude" / "projects" / "-repo"
        self.projects.mkdir(parents=True)
        self.prices = self.tmp / "prices.json"
        self.prices.write_text(json.dumps(FIXTURE_PRICES), encoding="utf-8")
        routing = {"story": "9-1", "session": {"model": "model-a", "effort": "high"},
                   "implementer": {"model": "model-b"}, "consult_triggers": ["halt"]}
        (self.repo / ".bmad-loop" / "routing.current.json").write_text(
            json.dumps(routing), encoding="utf-8")
        self._event_n = 0

    def tearDown(self):
        if self._old_home is None:
            os.environ.pop("TK_STUDIO_HOME", None)
        else:
            os.environ["TK_STUDIO_HOME"] = self._old_home
        self._tmp.cleanup()

    # ------------------------------------------------------------ fixtures

    def _jsonl(self, path: Path, lines: list[dict]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("".join(json.dumps(x) + "\n" for x in lines), encoding="utf-8")

    def add_session(self, task_id, session_id, lines, subagents=None, exists=True):
        transcript = self.projects / f"{session_id}.jsonl"
        if exists:
            self._jsonl(transcript, lines)
        for agent, (meta, sub_lines) in (subagents or {}).items():
            sub_dir = self.projects / session_id / "subagents"
            self._jsonl(sub_dir / f"agent-{agent}.jsonl", sub_lines)
            (sub_dir / f"agent-{agent}.meta.json").write_text(json.dumps(meta), encoding="utf-8")
        for event in ("SessionStart", "Stop"):
            self._event_n += 1
            (self.run_dir / "events" / f"{self._event_n:04d}-{task_id}-{event}.json").write_text(
                json.dumps({"ts": self._event_n, "event": event, "task_id": task_id,
                            "session_id": session_id,
                            "transcript_path": str(transcript)}), encoding="utf-8")
        return transcript

    def write_journal(self, lines):
        self._jsonl(self.run_dir / "journal.jsonl", lines)

    def write_state(self, attempt):
        (self.run_dir / "state.json").write_text(json.dumps(
            {"tasks": {KEY: {"story_key": KEY, "attempt": attempt},
                       OTHER: {"story_key": OTHER, "attempt": 7}}}), encoding="utf-8")

    def run_cli(self, *extra) -> tuple[int, dict]:
        buf = io.StringIO()
        with redirect_stdout(buf):
            rc = meter.main(["story", "--run-dir", str(self.run_dir), "--story-key", KEY,
                             "--repo-root", str(self.repo), "--prices", str(self.prices),
                             *extra])
        return rc, json.loads(buf.getvalue())

    def ledger_lines(self) -> list[dict]:
        path = ledger.ledger_path()
        if not path.is_file():
            return []
        return [json.loads(line) for line
                in path.read_text(encoding="utf-8").splitlines() if line]

    def basic_story(self):
        self.add_session(f"{KEY}-dev-1", "s-dev", [usage_line("m1", "model-a", inp=M)])
        self.write_journal([{"ts": 100.0, "kind": "session-start", "story_key": KEY,
                             "role": "dev", "model": "model-a"},
                            {"ts": 160.5, "kind": "story-done", "story_key": KEY,
                             "commit": "abc"}])
        self.write_state(1)

    # ------------------------------------------------------------ I/O matrix

    def test_arithmetic_five_rates_sum_exactly(self):
        self.add_session(f"{KEY}-dev-1", "s-dev", [
            usage_line("m1", "model-a", inp=M, out=M, cw5=M, cw1=M, cr=M)])
        rc, out = self.run_cli("--no-record")
        self.assertEqual(rc, 0, out)
        self.assertAlmostEqual(out["usd_total"], 1.0 + 2.0 + 3.0 + 4.0 + 5.0)
        self.assertAlmostEqual(out["usd_by_model"]["model-a"], 15.0)
        self.assertAlmostEqual(out["usd_by_leg"]["session"], 15.0)
        self.assertFalse(out["ttl_unknown"])

    def test_duplicate_message_ids_counted_once(self):
        line = usage_line("m1", "model-a", inp=M)
        self.add_session(f"{KEY}-dev-1", "s-dev", [line, line, line,
                                                    usage_line("m2", "model-a", out=M)])
        rc, out = self.run_cli("--no-record")
        self.assertEqual(rc, 0, out)
        self.assertAlmostEqual(out["usd_total"], 1.0 + 2.0)

    def test_missing_price_is_named_refusal_and_emits_nothing(self):
        self.basic_story()
        self.add_session(f"{KEY}-review-1", "s-rev", [usage_line("r1", "model-zzz", inp=M)])
        rc, out = self.run_cli()
        self.assertEqual(rc, 2)
        self.assertFalse(out["ok"])
        self.assertIn("model-zzz", out["error"])
        self.assertNotIn("usd_total", out)
        self.assertEqual(self.ledger_lines(), [])
        self.assertFalse((self.run_dir / "transcripts" / KEY / meter.MARKER).exists())

    def test_mixed_model_per_model_and_per_leg_sum_to_total(self):
        self.add_session(f"{KEY}-dev-1", "s-dev", [usage_line("m1", "model-a", inp=M, out=M)],
                         subagents={"i1": ({"agentType": "general-purpose",
                                            "description": "Implement story 9-1",
                                            "model": "b"},
                                           [usage_line("s1", "model-b", inp=M)])})
        rc, out = self.run_cli("--no-record")
        self.assertEqual(rc, 0, out)
        self.assertAlmostEqual(out["usd_by_model"]["model-a"], 3.0)
        self.assertAlmostEqual(out["usd_by_model"]["model-b"], 10.0)
        self.assertAlmostEqual(out["usd_by_leg"]["session"], 3.0)
        self.assertAlmostEqual(out["usd_by_leg"]["implementer"], 10.0)
        self.assertAlmostEqual(sum(out["usd_by_model"].values()), out["usd_total"])
        self.assertAlmostEqual(sum(out["usd_by_leg"].values()), out["usd_total"])
        self.assertAlmostEqual(out["usd_total"], 13.0)

    def test_no_ttl_split_prices_at_5m_and_flags(self):
        self.add_session(f"{KEY}-dev-1", "s-dev", [
            usage_line("m1", "model-a", cw5=M, split=False)])
        rc, out = self.run_cli("--no-record")
        self.assertEqual(rc, 0, out)
        self.assertAlmostEqual(out["usd_total"], 3.0)
        self.assertTrue(out["ttl_unknown"])

    def test_timing_ignores_interleaved_story_and_reads_attempts(self):
        self.add_session(f"{KEY}-dev-1", "s-dev", [usage_line("m1", "model-a", inp=M)])
        self.write_journal([
            {"ts": 50.0, "kind": "session-start", "story_key": OTHER, "role": "dev"},
            {"ts": 100.0, "kind": "session-start", "story_key": KEY, "role": "dev"},
            {"ts": 120.0, "kind": "story-done", "story_key": OTHER, "commit": "x"},
            {"ts": 130.0, "kind": "session-start", "story_key": KEY, "role": "review"},
            {"ts": 400.25, "kind": "story-done", "story_key": KEY, "commit": "y"},
        ])
        self.write_state(3)
        rc, out = self.run_cli("--no-record")
        self.assertEqual(rc, 0, out)
        self.assertAlmostEqual(out["wall_clock_s"], 300.25)
        self.assertEqual(out["attempts"], 3)

    def test_wall_clock_null_when_story_done_missing(self):
        self.add_session(f"{KEY}-dev-1", "s-dev", [usage_line("m1", "model-a", inp=M)])
        self.write_journal([{"ts": 100.0, "kind": "session-start", "story_key": KEY}])
        rc, out = self.run_cli("--no-record")
        self.assertEqual(rc, 0, out)
        self.assertIsNone(out["wall_clock_s"])
        self.assertIsNone(out["attempts"])

    def test_copy_out_lands_session_and_subagents_and_names_missing(self):
        self.add_session(f"{KEY}-dev-1", "s-dev", [usage_line("m1", "model-a", inp=M)],
                         subagents={"h1": ({"agentType": "general-purpose",
                                            "description": "Edge case hunter review 9-1"},
                                           [usage_line("s1", "model-a", out=M)])})
        gone = self.add_session(f"{KEY}-review-1", "s-gone", [], exists=False)
        rc, out = self.run_cli("--no-record")
        self.assertEqual(rc, 0, out)
        dest = self.run_dir / "transcripts" / KEY / f"{KEY}-dev-1"
        self.assertTrue((dest / "s-dev.jsonl").is_file())
        self.assertTrue((dest / "subagents" / "agent-h1.jsonl").is_file())
        self.assertTrue((dest / "subagents" / "agent-h1.meta.json").is_file())
        self.assertEqual(out["missing_transcripts"], [str(gone)])
        self.assertAlmostEqual(out["usd_by_leg"]["reviewers"], 2.0)

    def test_idempotent_rerun_emits_one_observation(self):
        self.basic_story()
        rc1, out1 = self.run_cli()
        rc2, out2 = self.run_cli()
        self.assertEqual((rc1, rc2), (0, 0))
        self.assertTrue(out1["recorded"])
        self.assertFalse(out2["recorded"])
        self.assertTrue((self.run_dir / "transcripts" / KEY / meter.MARKER).is_file())
        self.assertEqual(len(self.ledger_lines()), 1)

    def test_seam_and_supervise_present_as_zero(self):
        self.basic_story()
        rc, out = self.run_cli("--no-record")
        self.assertEqual(rc, 0, out)
        for leg in meter.LEGS:
            self.assertIn(leg, out["usd_by_leg"])
        self.assertEqual(out["usd_by_leg"]["seam"], 0)
        self.assertEqual(out["usd_by_leg"]["supervise"], 0)
        self.assertNotIn("unknown", out["usd_by_leg"])

    # ------------------------------------------------------------ advisor (Story 26.3)

    @staticmethod
    def advisor_line(mid, model, iterations, inp=0, out=0):
        line = usage_line(mid, model, inp=inp, out=out)
        line["message"]["usage"]["iterations"] = iterations
        return line

    def test_advisor_usage_priced_as_its_own_leg(self):
        self.add_session(f"{KEY}-dev-1", "s-dev", [self.advisor_line("m1", "model-a", [
            {"type": "message", "input_tokens": M},
            {"type": meter.ADVISOR_ITERATION, "model": "model-b",
             "input_tokens": M, "output_tokens": M, "cache_read_input_tokens": M,
             "cache_creation_input_tokens": M}], inp=M)])
        rc, out = self.run_cli("--no-record")
        self.assertEqual(rc, 0, out)
        self.assertEqual(meter.ADVISOR_ITERATION, "advisor_message")
        # the advisor's call at model-b's rates: 10 + 20 + 50 + 30 (5m write)
        self.assertAlmostEqual(out["usd_by_leg"]["advisor"], 110.0)
        # the executor's leg keeps only the top-level usage
        self.assertAlmostEqual(out["usd_by_leg"]["session"], 1.0)
        self.assertAlmostEqual(out["usd_by_model"]["model-b"], 110.0)
        self.assertAlmostEqual(out["usd_total"], 111.0)
        desc = meter.describe(KEY, dict(out, route=None))
        self.assertIn("advisor:110.0", desc)

    def test_advisor_on_a_subagent_record_stays_out_of_the_subagent_leg(self):
        self.add_session(f"{KEY}-dev-1", "s-dev", [usage_line("m1", "model-a", inp=M)],
                         subagents={"i1": ({"description": "Implement story"}, [
                             self.advisor_line("x1", "model-a", [
                                 {"type": meter.ADVISOR_ITERATION, "model": "model-a-alias",
                                  "output_tokens": M}], inp=M)])})
        rc, out = self.run_cli("--no-record")
        self.assertEqual(rc, 0, out)
        self.assertAlmostEqual(out["usd_by_leg"]["implementer"], 1.0)
        self.assertAlmostEqual(out["usd_by_leg"]["advisor"], 2.0)
        self.assertAlmostEqual(out["usd_by_leg"]["session"], 1.0)

    def test_advisor_cache_write_split_prices_the_1h_rate(self):
        self.add_session(f"{KEY}-dev-1", "s-dev", [self.advisor_line("m1", "model-a", [
            {"type": meter.ADVISOR_ITERATION, "model": "model-b",
             "cache_creation_input_tokens": M,
             "cache_creation": {"ephemeral_5m_input_tokens": 0,
                                "ephemeral_1h_input_tokens": M}}], inp=M)])
        rc, out = self.run_cli("--no-record")
        self.assertEqual(rc, 0, out)
        self.assertAlmostEqual(out["usd_by_leg"]["advisor"], 40.0)  # model-b 1h write
        self.assertEqual(out["tokens_by_model"]["model-b"]["cache_write_1h"], M)
        self.assertFalse(out["ttl_unknown"])

    def test_advisor_unsplit_cache_write_flags_ttl_unknown(self):
        self.add_session(f"{KEY}-dev-1", "s-dev", [self.advisor_line("m1", "model-a", [
            {"type": meter.ADVISOR_ITERATION, "model": "model-b",
             "cache_creation_input_tokens": M}], inp=M)])
        rc, out = self.run_cli("--no-record")
        self.assertEqual(rc, 0, out)
        self.assertTrue(out["ttl_unknown"])

    def test_premium_advisor_usage_refuses_like_the_executor(self):
        for field, value in (("speed", "fast"), ("service_tier", "priority")):
            with self.subTest(field=field):
                self.add_session(f"{KEY}-dev-1", "s-dev", [self.advisor_line("m1", "model-a", [
                    {"type": meter.ADVISOR_ITERATION, "model": "model-b",
                     "input_tokens": M, field: value}], inp=M)])
                rc, out = self.run_cli("--no-record")
                self.assertEqual(rc, 2)
                self.assertFalse(out["ok"])
                self.assertIn(f"no price for model(s) 'model-b ({field}={value})'",
                              out["error"])

    def test_unpriced_advisor_model_refuses_by_name(self):
        self.add_session(f"{KEY}-dev-1", "s-dev", [self.advisor_line("m1", "model-a", [
            {"type": meter.ADVISOR_ITERATION, "model": "model-zz", "input_tokens": 5}], inp=M)])
        rc, out = self.run_cli("--no-record")
        self.assertEqual(rc, 2)
        self.assertFalse(out["ok"])
        self.assertIn("no price for model(s) 'model-zz'", out["error"])

    def test_advisor_iteration_without_model_refuses(self):
        self.add_session(f"{KEY}-dev-1", "s-dev", [self.advisor_line("m1", "model-a", [
            {"type": meter.ADVISOR_ITERATION, "input_tokens": 5}], inp=M)])
        rc, out = self.run_cli("--no-record")
        self.assertEqual(rc, 2)
        self.assertIn("advisor usage without a model", out["error"])

    def test_no_advisor_usage_names_the_leg_at_zero(self):
        self.basic_story()
        rc, out = self.run_cli("--no-record")
        self.assertEqual(rc, 0, out)
        self.assertIn("advisor", meter.LEGS)
        self.assertEqual(out["usd_by_leg"]["advisor"], 0)
        self.assertIn("advisor:0.0", meter.describe(KEY, out))

    # ------------------------------------------------------------ acceptance

    def test_report_fields_and_one_observation_shape(self):
        self.basic_story()
        rc, out = self.run_cli()
        self.assertEqual(rc, 0, out)
        for field in ("usd_total", "usd_by_model", "usd_by_leg", "wall_clock_s",
                      "attempts", "route", "prices_date", "ttl_unknown"):
            self.assertIn(field, out)
        self.assertEqual(out["route"], {"session": "model-a", "implementer": "model-b"})
        self.assertEqual(out["prices_date"], "2000-01-01")
        self.assertAlmostEqual(out["wall_clock_s"], 60.5)
        lines = self.ledger_lines()
        self.assertEqual(len(lines), 1)
        event = lines[0]
        self.assertEqual(event["event"], "observation")
        payload = event["payload"]
        self.assertEqual(payload["source"], "other")
        desc = payload["description"]
        self.assertTrue(desc.startswith("meter:"))
        for part in (f"story={KEY}", "route=session:model-a,implementer:model-b",
                     "usd=1.0", "usd_by_model=model-a:1.0", "usd_by_leg=session:1.0",
                     "wall_clock_s=60.5", "attempts=1"):
            self.assertIn(part, desc)
        self.assertEqual(payload["evidence"],
                         ".bmad-loop/runs/20000101-000000-1/transcripts/" + KEY)

    def test_leg_attribution(self):
        self.assertEqual(meter.leg_for("dev"), "session")
        self.assertEqual(meter.leg_for("review"), "review")
        self.assertEqual(meter.leg_for("triage"), "triage")
        self.assertEqual(meter.leg_for("weird"), "unknown")
        self.assertEqual(meter.leg_for("dev", {"description": "Consult on halt"}), "consult")
        self.assertEqual(meter.leg_for("dev", {"description": "Blind hunter review"}), "reviewers")
        self.assertEqual(meter.leg_for("dev", {"description": "Apply review patches"}),
                         "implementer")
        self.assertEqual(meter.leg_for("review", {"description": "Implement"}), "implementer")
        self.assertEqual(meter.leg_for("triage", {"description": "Implement"}), "implementer")
        self.assertEqual(meter.leg_for("weird", {"description": "Blind hunter review"}),
                         "unknown")

    def test_unknown_role_goes_to_named_unknown_bucket(self):
        self.add_session(f"{KEY}-weird-1", "s-w", [usage_line("w1", "model-a", inp=M)])
        rc, out = self.run_cli("--no-record")
        self.assertEqual(rc, 0, out)
        self.assertAlmostEqual(out["usd_by_leg"]["unknown"], 1.0)

    def test_synthetic_zero_usage_skipped_and_alias_resolves(self):
        self.add_session(f"{KEY}-dev-1", "s-dev", [
            usage_line("z1", "<synthetic>"),
            usage_line("m1", "model-a-alias", inp=M)])
        rc, out = self.run_cli("--no-record")
        self.assertEqual(rc, 0, out)
        self.assertAlmostEqual(out["usd_by_model"]["model-a"], 1.0)

    # ------------------------------------------------------------ review patches

    def test_dedupe_keeps_last_line_of_each_message_id(self):
        self.add_session(f"{KEY}-dev-1", "s-dev", [
            usage_line("m1", "model-a", out=10),
            usage_line("m1", "model-a", out=500),
            usage_line(None, "model-a", inp=M),
            usage_line(None, "model-a", inp=M)])
        rc, out = self.run_cli("--no-record")
        self.assertEqual(rc, 0, out)
        self.assertEqual(out["tokens_by_model"]["model-a"]["output"], 500)
        self.assertAlmostEqual(out["usd_total"], 500 * 2.0 / M + 2 * 1.0)

    def test_missing_transcripts_count_in_observation(self):
        self.basic_story()
        self.add_session(f"{KEY}-review-1", "s-gone", [], exists=False)
        rc, out = self.run_cli()
        self.assertEqual(rc, 0, out)
        self.assertEqual(len(out["missing_transcripts"]), 1)
        desc = self.ledger_lines()[0]["payload"]["description"]
        self.assertIn("missing_transcripts=1", desc)
        self.assertIn("attempts=1 missing_transcripts=1 ", desc)

    def test_plugin_workflow_task_id_priced_under_unknown(self):
        self.basic_story()
        task = f"{KEY}-studio-pipeline.gate-1"
        self.add_session(task, "s-gate", [usage_line("g1", "model-a", out=M)])
        rc, out = self.run_cli("--no-record")
        self.assertEqual(rc, 0, out)
        self.assertTrue((self.run_dir / "transcripts" / KEY / task / "s-gate.jsonl").is_file())
        self.assertAlmostEqual(out["usd_by_leg"]["unknown"], 2.0)
        self.assertAlmostEqual(out["usd_total"], 3.0)
        gate = [s for s in out["sessions"] if s["task_id"] == task][0]
        self.assertEqual((gate["role"], gate["leg"]), ("studio-pipeline.gate", "unknown"))

    def test_longer_story_key_tasks_not_claimed(self):
        self.basic_story()
        longer = f"{KEY}-two"
        state = json.loads((self.run_dir / "state.json").read_text(encoding="utf-8"))
        state["tasks"][longer] = {"story_key": longer, "attempt": 1}
        (self.run_dir / "state.json").write_text(json.dumps(state), encoding="utf-8")
        self.add_session(f"{longer}-dev-1", "s-two", [usage_line("t1", "model-b", inp=M)])
        rc, out = self.run_cli("--no-record")
        self.assertEqual(rc, 0, out)
        self.assertAlmostEqual(out["usd_total"], 1.0)
        self.assertEqual([s["task_id"] for s in out["sessions"]], [f"{KEY}-dev-1"])

    def test_partial_ttl_split_remainder_priced_at_5m_and_flagged(self):
        line = usage_line("m1", "model-a", cw5=100, cw1=200)
        line["message"]["usage"]["cache_creation_input_tokens"] = 1000
        self.add_session(f"{KEY}-dev-1", "s-dev", [line])
        rc, out = self.run_cli("--no-record")
        self.assertEqual(rc, 0, out)
        self.assertEqual(out["tokens_by_model"]["model-a"]["cache_write_5m"], 800)
        self.assertEqual(out["tokens_by_model"]["model-a"]["cache_write_1h"], 200)
        self.assertAlmostEqual(out["usd_total"], (800 * 3.0 + 200 * 4.0) / M)
        self.assertTrue(out["ttl_unknown"])

    def test_full_ttl_split_not_flagged(self):
        self.add_session(f"{KEY}-dev-1", "s-dev", [usage_line("m1", "model-a", cw5=100, cw1=200)])
        rc, out = self.run_cli("--no-record")
        self.assertEqual(rc, 0, out)
        self.assertFalse(out["ttl_unknown"])

    def test_acceptance_auditor_maps_to_reviewers(self):
        self.assertEqual(meter.leg_for("dev", {"description": "Acceptance Auditor review 9-1"}),
                         "reviewers")
        self.assertEqual(meter.leg_for("dev", {"agentType": "acceptance-auditor"}), "reviewers")

    def test_null_wall_clock_and_attempts_render_none(self):
        self.add_session(f"{KEY}-dev-1", "s-dev", [usage_line("m1", "model-a", inp=M)])
        rc, out = self.run_cli()
        self.assertEqual(rc, 0, out)
        desc = self.ledger_lines()[0]["payload"]["description"]
        self.assertIn("wall_clock_s=none attempts=none", desc)
        self.assertNotIn("None", desc)

    def test_subagent_attached_once_per_task_with_two_transcripts(self):
        task = f"{KEY}-dev-1"
        self.add_session(task, "s-one", [usage_line("m1", "model-a", inp=M)],
                         subagents={"i1": ({"description": "Implement story 9-1"},
                                           [usage_line(None, "model-b", inp=M)])})
        self.add_session(task, "s-two", [usage_line("m2", "model-a", inp=M)])
        rc, out = self.run_cli("--no-record")
        self.assertEqual(rc, 0, out)
        self.assertEqual(len(out["sessions"]), 2)
        self.assertEqual(sum(len(s["subagents"]) for s in out["sessions"]), 1)
        self.assertAlmostEqual(out["usd_by_leg"]["implementer"], 10.0)
        self.assertAlmostEqual(out["usd_total"], 12.0)

    def test_committed_price_table_holds_the_five_kb_models(self):
        table = meter.load_prices()
        self.assertEqual(table["date"], "2026-09-28")
        self.assertTrue(table["source"])
        self.assertEqual(set(table["models"]), {
            "claude-opus-5-5", "claude-opus-5", "claude-fable-5-1",
            "claude-sonnet-5", "claude-haiku-4-5-20251001"})
        self.assertEqual(table["aliases"]["claude-haiku-4-5"], "claude-haiku-4-5-20251001")
        # kb/execution-pipeline-model-routing.md, "Price table for the trial meter":
        # input, output, cache write 5m, cache write 1h, cache read (USD / MTok).
        kb = {"claude-opus-5-5": (4.00, 20.00, 5.00, 8.00, 0.20),
              "claude-opus-5": (5.00, 25.00, 6.25, 10.00, 0.50),
              "claude-fable-5-1": (10.00, 50.00, 12.50, 20.00, 0.25),
              "claude-sonnet-5": (2.00, 10.00, 2.50, 4.00, 0.20),
              "claude-haiku-4-5-20251001": (1.00, 5.00, 1.25, 2.00, 0.10)}
        for model, figures in kb.items():
            rates = table["models"][model]
            self.assertEqual(tuple(rates[f] for f in meter.RATE_FIELDS), figures, model)
        self.assertEqual(meter._rates(table, "claude-haiku-4-5"),
                         table["models"]["claude-haiku-4-5-20251001"])
        for model, rates in table["models"].items():
            self.assertIn("cache_write_5m", rates["derived"], model)
            self.assertIn("cache_write_1h", rates["derived"], model)
            expected = model not in ("claude-opus-5-5", "claude-fable-5-1")
            self.assertEqual("cache_read" in rates["derived"], expected, model)

    # ------------------------------------------------------------ review patches (2)

    def test_review_session_subagents_classified_before_parent_leg(self):
        for desc in ("Blind hunter review 24-1", "Edge case hunter review 24-1"):
            self.assertEqual(meter.leg_for("review", {"description": desc}), "reviewers")
        self.assertEqual(meter.leg_for("review", {"description": "Consult on the escalation"}),
                         "consult")
        self.assertEqual(meter.leg_for("triage", {"agentType": "acceptance-auditor"}),
                         "reviewers")
        self.assertEqual(meter.leg_for("review", {"description": "Read the diff"}),
                         "implementer")

    def test_review_session_hunter_subagent_billed_to_reviewers(self):
        self.add_session(f"{KEY}-review-1", "s-rev", [usage_line("r1", "model-a", inp=M)],
                         subagents={"h1": ({"description": "Blind hunter review 9-1"},
                                           [usage_line("h1", "model-b", inp=M)]),
                                    "c1": ({"description": "Consult on halt"},
                                           [usage_line("c1", "model-a", out=M)])})
        rc, out = self.run_cli("--no-record")
        self.assertEqual(rc, 0, out)
        self.assertAlmostEqual(out["usd_by_leg"]["review"], 1.0)
        self.assertAlmostEqual(out["usd_by_leg"]["reviewers"], 10.0)
        self.assertAlmostEqual(out["usd_by_leg"]["consult"], 2.0)

    def test_observation_project_follows_tracked_project_id(self):
        import config as configlib
        self.basic_story()
        tracked = self.repo / ".tk-studio" / configlib.TRACKED_NAME
        tracked.parent.mkdir(parents=True, exist_ok=True)
        tracked.write_text("project_id: studio-x\n", encoding="utf-8")
        rc, out = self.run_cli()
        self.assertEqual(rc, 0, out)
        lines = self.ledger_lines()
        self.assertEqual(len(lines), 1)
        self.assertEqual(lines[0]["project"], "studio-x")

    def test_observation_project_defaults_to_root_basename(self):
        self.basic_story()
        rc, out = self.run_cli()
        self.assertEqual(rc, 0, out)
        self.assertEqual(self.ledger_lines()[0]["project"], "repo")

    def test_record_flags_ttl_unknown_and_prices_date(self):
        self.add_session(f"{KEY}-dev-1", "s-dev", [
            usage_line("m1", "model-a", cw5=M, split=False)])
        rc, out = self.run_cli()
        self.assertEqual(rc, 0, out)
        desc = self.ledger_lines()[0]["payload"]["description"]
        self.assertTrue(desc.endswith("ttl_unknown=true prices_date=2000-01-01"), desc)
        marker = json.loads((self.run_dir / "transcripts" / KEY / meter.MARKER)
                            .read_text(encoding="utf-8"))
        self.assertIs(marker["ttl_unknown"], True)

    def test_record_default_ttl_unknown_false(self):
        self.basic_story()
        rc, out = self.run_cli()
        self.assertEqual(rc, 0, out)
        desc = self.ledger_lines()[0]["payload"]["description"]
        self.assertIn("missing_transcripts=0 ttl_unknown=false prices_date=2000-01-01", desc)
        marker = json.loads((self.run_dir / "transcripts" / KEY / meter.MARKER)
                            .read_text(encoding="utf-8"))
        self.assertIs(marker["ttl_unknown"], False)

    def test_non_object_model_entry_is_json_refusal(self):
        self.basic_story()
        self.prices.write_text(json.dumps({**FIXTURE_PRICES, "models": {"m": [1]}}),
                               encoding="utf-8")
        rc, out = self.run_cli()
        self.assertEqual(rc, 2)
        self.assertFalse(out["ok"])
        self.assertIn("'m'", out["error"])
        self.assertEqual(self.ledger_lines(), [])

    def test_shallow_run_dir_without_repo_root_is_json_refusal(self):
        shallow = Path(self.tmp.anchor)
        buf = io.StringIO()
        with redirect_stdout(buf):
            rc = meter.main(["story", "--run-dir", str(shallow), "--story-key", KEY,
                             "--prices", str(self.prices)])
        self.assertEqual(rc, 2)
        out = json.loads(buf.getvalue())
        self.assertFalse(out["ok"])
        self.assertIn("--repo-root", out["error"])

    def test_fast_speed_is_named_refusal_and_emits_nothing(self):
        self.basic_story()
        line = usage_line("f1", "model-a", inp=M)
        line["message"]["usage"]["speed"] = "fast"
        self.add_session(f"{KEY}-review-1", "s-rev", [line])
        rc, out = self.run_cli()
        self.assertEqual(rc, 2)
        self.assertFalse(out["ok"])
        self.assertIn("model-a (speed=fast)", out["error"])
        self.assertNotIn("usd_total", out)
        self.assertEqual(self.ledger_lines(), [])
        self.assertFalse((self.run_dir / "transcripts" / KEY / meter.MARKER).exists())

    def test_standard_modifiers_price_normally(self):
        line = usage_line("m1", "model-a", inp=M)
        line["message"]["usage"].update({"speed": "standard", "service_tier": "standard",
                                         "inference_geo": "not_available"})
        zero = usage_line("z1", "<synthetic>")
        zero["message"]["usage"]["speed"] = "fast"
        self.add_session(f"{KEY}-dev-1", "s-dev", [line, zero])
        rc, out = self.run_cli("--no-record")
        self.assertEqual(rc, 0, out)
        self.assertAlmostEqual(out["usd_total"], 1.0)

    # ------------------------------------------------------------ review patches (3)

    def test_review_session_implementer_relaunches_billed_to_implementer(self):
        real = ("Implementer: 24-1 review patches", "Apply review patches 24-1",
                "Apply review patches 20-2", "Apply 2 review patches",
                "Fix unescaped pipes in finish row")
        for desc in real:
            self.assertEqual(meter.leg_for("review", {"agentType": "general-purpose",
                                                      "description": desc}),
                             "implementer", desc)
            self.assertIsNone(meter.re.search(r"hunter|reviewer|review layer|auditor",
                                              desc.lower()), desc)
        subagents = {f"p{i}": ({"agentType": "general-purpose", "description": desc},
                               [usage_line(f"p{i}", "model-b", inp=M)])
                     for i, desc in enumerate(real)}
        self.add_session(f"{KEY}-review-1", "s-rev", [usage_line("r1", "model-a", inp=M)],
                         subagents=subagents)
        rc, out = self.run_cli("--no-record")
        self.assertEqual(rc, 0, out)
        self.assertAlmostEqual(out["usd_by_leg"]["review"], 1.0)
        self.assertAlmostEqual(out["usd_by_leg"]["implementer"], 10.0 * len(real))
        self.assertAlmostEqual(out["usd_by_leg"]["reviewers"], 0.0)

    def test_refusal_written_to_run_dir_naming_model_without_observation(self):
        self.basic_story()
        self.add_session(f"{KEY}-review-1", "s-rev", [usage_line("r1", "model-zzz", inp=M)])
        rc, out = self.run_cli()
        self.assertEqual(rc, 2)
        path = self.run_dir / "transcripts" / KEY / meter.REFUSAL
        self.assertTrue(path.is_file())
        saved = json.loads(path.read_text(encoding="utf-8"))
        self.assertEqual({k: saved[k] for k in ("ok", "error")}, out)
        self.assertIn("model-zzz", saved["error"])
        self.assertRegex(saved["ts"], r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$")
        self.assertEqual(self.ledger_lines(), [])
        self.assertFalse((self.run_dir / "transcripts" / KEY / meter.MARKER).exists())

    def test_later_successful_run_removes_stale_refusal(self):
        self.basic_story()
        self.add_session(f"{KEY}-review-1", "s-rev", [usage_line("r1", "model-zzz", inp=M)])
        rc, _ = self.run_cli()
        self.assertEqual(rc, 2)
        path = self.run_dir / "transcripts" / KEY / meter.REFUSAL
        self.assertTrue(path.is_file())
        fixed = {**FIXTURE_PRICES, "models": {**FIXTURE_PRICES["models"],
                                              "model-zzz": FIXTURE_PRICES["models"]["model-a"]}}
        self.prices.write_text(json.dumps(fixed), encoding="utf-8")
        rc, out = self.run_cli()
        self.assertEqual(rc, 0, out)
        self.assertTrue(out["recorded"])
        self.assertFalse(path.exists())
        self.assertEqual(len(self.ledger_lines()), 1)

    def test_refusal_file_write_failure_keeps_printed_refusal(self):
        self.basic_story()
        self.add_session(f"{KEY}-review-1", "s-rev", [usage_line("r1", "model-zzz", inp=M)])
        original = meter._atomic_write_text

        def failing(path, text):
            if path.name == meter.REFUSAL:
                raise OSError("disk full")
            return original(path, text)
        meter._atomic_write_text = failing
        try:
            rc, out = self.run_cli()
        finally:
            meter._atomic_write_text = original
        self.assertEqual(rc, 2)
        self.assertEqual(set(out), {"ok", "error"})
        self.assertIn("model-zzz", out["error"])

    def test_web_search_requests_is_named_refusal_and_emits_nothing(self):
        self.basic_story()
        line = usage_line("w1", "model-a", inp=M)
        line["message"]["usage"]["server_tool_use"] = {"web_search_requests": 3,
                                                       "web_fetch_requests": 0}
        self.add_session(f"{KEY}-review-1", "s-rev", [line])
        rc, out = self.run_cli()
        self.assertEqual(rc, 2)
        self.assertFalse(out["ok"])
        self.assertIn("model-a (web_search_requests=3)", out["error"])
        self.assertNotIn("usd_total", out)
        self.assertEqual(self.ledger_lines(), [])
        self.assertFalse((self.run_dir / "transcripts" / KEY / meter.MARKER).exists())

    def test_web_fetch_requests_is_named_refusal(self):
        line = usage_line("w1", "model-b", out=M)
        line["message"]["usage"]["server_tool_use"] = {"web_search_requests": 0,
                                                       "web_fetch_requests": 1}
        self.add_session(f"{KEY}-dev-1", "s-dev", [line])
        rc, out = self.run_cli("--no-record")
        self.assertEqual(rc, 2)
        self.assertIn("model-b (web_fetch_requests=1)", out["error"])

    def test_zero_server_tool_counts_price_normally(self):
        line = usage_line("m1", "model-a", inp=M, out=M)
        line["message"]["usage"]["server_tool_use"] = {"web_search_requests": 0,
                                                       "web_fetch_requests": 0}
        self.add_session(f"{KEY}-dev-1", "s-dev", [line])
        rc, out = self.run_cli("--no-record")
        self.assertEqual(rc, 0, out)
        self.assertAlmostEqual(out["usd_total"], 3.0)
        self.assertAlmostEqual(out["usd_by_leg"]["session"], 3.0)

    def test_journal_session_start_role_overrides_task_label(self):
        self.basic_story()
        task = f"{KEY}-studio-pipeline.gate-1"
        self.add_session(task, "s-gate", [usage_line("g1", "model-a", out=M)],
                         subagents={"i1": ({"description": "Apply review patches 9-1"},
                                           [usage_line("i1", "model-b", inp=M)])})
        journal = [json.loads(x) for x in (self.run_dir / "journal.jsonl")
                   .read_text(encoding="utf-8").splitlines()]
        journal.insert(1, {"ts": 150.0, "kind": "session-start", "task_id": task,
                           "role": "review", "adapter": "claude", "model": "model-a",
                           "story_key": KEY})
        self.write_journal(journal)
        rc, out = self.run_cli("--no-record")
        self.assertEqual(rc, 0, out)
        self.assertAlmostEqual(out["usd_by_leg"]["review"], 2.0)
        self.assertAlmostEqual(out["usd_by_leg"]["implementer"], 10.0)
        self.assertNotIn("unknown", out["usd_by_leg"])
        gate = [s for s in out["sessions"] if s["task_id"] == task][0]
        self.assertEqual((gate["role"], gate["leg"]), ("review", "review"))

    def test_malformed_prices_refuse_after_copy_out(self):
        self.basic_story()
        self.prices.write_text("{not json", encoding="utf-8")
        rc, out = self.run_cli()
        self.assertEqual(rc, 2)
        self.assertFalse(out["ok"])
        self.assertIn("unreadable", out["error"])
        dest = self.run_dir / "transcripts" / KEY / f"{KEY}-dev-1"
        self.assertTrue((dest / "s-dev.jsonl").is_file())
        self.assertTrue((self.run_dir / "transcripts" / KEY / meter.REFUSAL).is_file())
        self.assertEqual(self.ledger_lines(), [])

    def test_non_utf8_prices_is_json_refusal(self):
        self.basic_story()
        self.prices.write_bytes(b'{"date": "\xff\xfe"}')
        rc, out = self.run_cli()
        self.assertEqual(rc, 2)
        self.assertFalse(out["ok"])
        self.assertIn("unreadable", out["error"])

    def test_non_utf8_state_and_event_do_not_raise(self):
        self.basic_story()
        (self.run_dir / "state.json").write_bytes(b'{"tasks": "\xff"}')
        (self.run_dir / "events" / "9999-bad.json").write_bytes(b"\xff\xfe{")
        rc, out = self.run_cli("--no-record")
        self.assertEqual(rc, 0, out)
        self.assertIsNone(out["attempts"])

    def test_non_object_aliases_is_named_refusal(self):
        self.basic_story()
        self.prices.write_text(json.dumps({**FIXTURE_PRICES, "aliases": ["model-a"]}),
                               encoding="utf-8")
        rc, out = self.run_cli()
        self.assertEqual(rc, 2)
        self.assertFalse(out["ok"])
        self.assertIn("'aliases'", out["error"])
        self.assertEqual(self.ledger_lines(), [])

    def test_non_string_alias_value_is_named_refusal(self):
        self.basic_story()
        self.prices.write_text(json.dumps({**FIXTURE_PRICES, "aliases": {"x-alias": 7}}),
                               encoding="utf-8")
        rc, out = self.run_cli()
        self.assertEqual(rc, 2)
        self.assertIn("'x-alias'", out["error"])

    def test_non_object_state_task_reads_attempts_as_unknown(self):
        self.basic_story()
        for tasks in ({KEY: 3}, {KEY: [1]}, {KEY: "x"}, ["not", "a", "map"]):
            (self.run_dir / "state.json").write_text(json.dumps({"tasks": tasks}),
                                                     encoding="utf-8")
            rc, out = self.run_cli("--no-record")
            self.assertEqual(rc, 0, (tasks, out))
            self.assertIsNone(out["attempts"], tasks)

    # ------------------------------------------------------------ harvest (Story 26.4)

    def story_dir(self, key=KEY) -> Path:
        return self.run_dir / "transcripts" / key

    def run_harvest(self, run_dir=None) -> tuple[int, dict]:
        buf = io.StringIO()
        with redirect_stdout(buf):
            rc = meter.main(["harvest", "--run-dir", str(run_dir or self.run_dir)])
        return rc, json.loads(buf.getvalue())

    def sandbox_observation(self, key, usd=1.5, user="agent", machine="sandbox-vm",
                            payload=None, metered=True):
        envelope = {"ts": "2026-10-15T00:00:00.000+00:00", "event": "observation",
                    "user": user, "machine": machine, "project": "tk-studio",
                    "payload": payload if payload is not None else
                    {"source": "other", "description": f"meter: story={key} usd={usd}",
                     "evidence": f"transcripts/{key}"}}
        d = self.story_dir(key)
        d.mkdir(parents=True, exist_ok=True)
        (d / meter.OBSERVATION).write_text(json.dumps(envelope), encoding="utf-8")
        if metered:
            (d / meter.MARKER).write_text(json.dumps({"story_key": key, "usd_total": usd}),
                                          encoding="utf-8")
        return envelope

    def test_metered_run_writes_observation_equal_to_ledger_line_before_marker(self):
        self.basic_story()
        order = []
        real = meter._atomic_write_text

        def spy(path, text):
            order.append(Path(path).name)
            real(path, text)

        meter._atomic_write_text = spy
        try:
            rc, out = self.run_cli()
        finally:
            meter._atomic_write_text = real
        self.assertEqual(rc, 0, out)
        self.assertEqual(order, [meter.OBSERVATION, meter.MARKER])
        written = json.loads((self.story_dir() / meter.OBSERVATION).read_text(encoding="utf-8"))
        self.assertEqual([written], self.ledger_lines())
        self.assertTrue((self.story_dir() / meter.MARKER).is_file())

    def test_no_record_writes_neither_observation_nor_marker(self):
        self.basic_story()
        rc, out = self.run_cli("--no-record")
        self.assertEqual(rc, 0, out)
        self.assertFalse((self.story_dir() / meter.OBSERVATION).exists())
        self.assertFalse((self.story_dir() / meter.MARKER).exists())

    def test_harvest_appends_sandbox_observation_exactly_once(self):
        self.sandbox_observation(KEY, usd=1.25)
        self.sandbox_observation(OTHER, usd=2.5)
        rc, out = self.run_harvest()
        self.assertEqual(rc, 0, out)
        self.assertTrue(out["ok"])
        self.assertEqual(out["harvested"], [{"story_key": KEY, "usd_total": 1.25},
                                            {"story_key": OTHER, "usd_total": 2.5}])
        self.assertAlmostEqual(out["usd_total"], 3.75)
        self.assertEqual(out["ledger"], str(ledger.ledger_path()))
        lines = self.ledger_lines()
        self.assertEqual(len(lines), 2)
        self.assertEqual(lines[0]["payload"]["description"], f"meter: story={KEY} usd=1.25")
        self.assertEqual(lines[0]["payload"]["evidence"], f"transcripts/{KEY}")
        self.assertEqual(lines[0]["project"], "tk-studio")
        marker = json.loads((self.story_dir() / meter.HARVESTED).read_text(encoding="utf-8"))
        self.assertEqual(marker["how"], "appended")
        self.assertEqual(marker["story_key"], KEY)
        self.assertEqual(marker["ledger"], ledger.ledger_path().name)
        self.assertIn("harvested_at", marker)
        rc2, out2 = self.run_harvest()
        self.assertEqual(rc2, 0, out2)
        self.assertEqual(out2["harvested"], [])
        self.assertEqual(out2["usd_total"], 0)
        self.assertEqual(out2["already_harvested"], [KEY, OTHER])
        self.assertEqual(len(self.ledger_lines()), 2)
        self.assertFalse((self.story_dir() / meter.REFUSAL).exists())

    def test_harvest_missing_metered_reports_null_dollars(self):
        self.sandbox_observation(KEY, metered=False)
        rc, out = self.run_harvest()
        self.assertEqual(rc, 0, out)
        self.assertEqual(out["harvested"], [{"story_key": KEY, "usd_total": None}])
        self.assertEqual(out["usd_total"], 0)

    def test_harvest_seeded_key_is_marked_not_appended(self):
        seeded = "25-1-the-roster-and-the-release-motion-for-every-app"
        self.sandbox_observation(seeded)
        rc, out = self.run_harvest()
        self.assertEqual(rc, 0, out)
        self.assertEqual(out["seeded"], [seeded])
        self.assertEqual(out["harvested"], [])
        self.assertEqual(self.ledger_lines(), [])
        marker = json.loads((self.story_dir(seeded) / meter.HARVESTED).read_text(encoding="utf-8"))
        self.assertEqual(marker["how"], "seeded")

    def test_harvest_host_emitted_is_marked_in_ledger(self):
        self.basic_story()
        rc, out = self.run_cli()
        self.assertEqual(rc, 0, out)
        rc, out = self.run_harvest()
        self.assertEqual(rc, 0, out)
        self.assertEqual(out["in_ledger"], [KEY])
        self.assertEqual(out["harvested"], [])
        self.assertEqual(len(self.ledger_lines()), 1)
        marker = json.loads((self.story_dir() / meter.HARVESTED).read_text(encoding="utf-8"))
        self.assertEqual(marker["how"], "in-ledger")

    def test_harvest_ignores_pre_26_4_dir(self):
        d = self.story_dir()
        d.mkdir(parents=True)
        (d / meter.MARKER).write_text(json.dumps({"story_key": KEY, "usd_total": 9.0}),
                                      encoding="utf-8")
        rc, out = self.run_harvest()
        self.assertEqual(rc, 0, out)
        for bucket in ("harvested", "already_harvested", "in_ledger", "seeded"):
            self.assertEqual(out[bucket], [], bucket)
        self.assertFalse((d / meter.HARVESTED).exists())
        self.assertEqual(self.ledger_lines(), [])

    def test_harvest_bad_file_refuses_and_appends_nothing(self):
        self.sandbox_observation(KEY)  # sorts first, valid
        bad_cases = ["{not json", json.dumps([1]),
                     json.dumps({"payload": {"source": "other"}}),
                     json.dumps({"payload": {"source": 3, "description": "x"}}),
                     json.dumps({"payload": {"source": "nope", "description": "x"}}),
                     json.dumps({"payload": {"source": "other", "description": "x",
                                             "evidence": 7}}),
                     json.dumps({"payload": {"source": "other", "description": "  "}}),
                     json.dumps({"project": 5,
                                 "payload": {"source": "other", "description": "x"}})]
        for text in bad_cases:
            d = self.story_dir(OTHER)
            d.mkdir(parents=True, exist_ok=True)
            path = d / meter.OBSERVATION
            path.write_text(text, encoding="utf-8")
            rc, out = self.run_harvest()
            self.assertEqual(rc, 2, (text, out))
            self.assertFalse(out["ok"])
            self.assertTrue(out["error"].startswith(f"observation {path} is unreadable: "),
                            out["error"])
            self.assertEqual(self.ledger_lines(), [], text)
            self.assertFalse((self.story_dir() / meter.HARVESTED).exists())
            self.assertFalse((d / meter.REFUSAL).exists())

    def test_harvest_corrupt_already_harvested_dir_does_not_block(self):
        self.sandbox_observation(KEY)  # sorts first; harvested, then corrupted
        (self.story_dir() / meter.HARVESTED).write_text("{}", encoding="utf-8")
        (self.story_dir() / meter.OBSERVATION).write_text("{not json", encoding="utf-8")
        self.sandbox_observation(OTHER, usd=2.0)
        rc, out = self.run_harvest()
        self.assertEqual(rc, 0, out)
        self.assertEqual(out["already_harvested"], [KEY])
        self.assertEqual(out["harvested"], [{"story_key": OTHER, "usd_total": 2.0}])
        self.assertEqual(len(self.ledger_lines()), 1)

    def test_harvest_in_ledger_check_uses_safe_names(self):
        import platform
        from unittest import mock
        with mock.patch.dict(os.environ, {"LOGNAME": "a b", "USER": "a b",
                                          "LNAME": "a b", "USERNAME": "a b"}):
            self.assertEqual(ledger.ledger_path().name,
                             f"a_b-{ledger._safe_name(platform.node())}.jsonl")
            self.basic_story()
            rc, out = self.run_cli()  # host-emitted: one line in the a_b ledger
            self.assertEqual(rc, 0, out)
            self.assertEqual(len(self.ledger_lines()), 1)
            # The envelope carries the raw, un-rewritten names.
            path = self.story_dir() / meter.OBSERVATION
            envelope = json.loads(path.read_text(encoding="utf-8"))
            envelope["user"], envelope["machine"] = "a b", platform.node()
            path.write_text(json.dumps(envelope), encoding="utf-8")
            rc, out = self.run_harvest()
            self.assertEqual(rc, 0, out)
            self.assertEqual(out["in_ledger"], [KEY])
            self.assertEqual(out["harvested"], [])
            self.assertEqual(len(self.ledger_lines()), 1)

    def test_the_observation_carries_the_structured_meter_fields(self):
        # Story 32.5 Settled shape 1: additive; the description unchanged
        self.add_session(f"{KEY}-dev-1", "s-dev", [
            usage_line("m1", "model-a", inp=M, out=2, cw5=3, cw1=4, cr=5)],
            subagents={"x1": ({"description": "Implement"},
                              [usage_line("x1", "model-b", inp=7)])})
        self.write_journal([{"ts": 100.0, "kind": "session-start", "story_key": KEY,
                             "role": "dev", "model": "model-a"},
                            {"ts": 160.5, "kind": "story-done", "story_key": KEY,
                             "commit": "abc"}])
        self.write_state(1)
        rc, out = self.run_cli()
        self.assertEqual(rc, 0, out)
        self.assertEqual(out["tokens_by_leg"]["session"],
                         {"input": M, "output": 2, "cache_read": 5, "cache_write": 7})
        written = json.loads((self.story_dir() / meter.OBSERVATION).read_text(encoding="utf-8"))
        self.assertEqual([written], self.ledger_lines())
        payload = written["payload"]
        self.assertEqual(payload["description"], meter.describe(KEY, out))
        self.assertEqual(payload["kind"], "meter")
        self.assertEqual(payload["story_key"], KEY)
        self.assertEqual(payload["epic"], 9)
        self.assertEqual(payload["usd"], out["usd_total"])
        self.assertEqual(payload["route"], {"session": "model-a",
                                            "implementer": "model-b"})
        self.assertEqual(payload["prices_date"], "2000-01-01")
        self.assertEqual(payload["legs"]["session"], {
            "usd": out["usd_by_leg"]["session"],
            "usage": {"input": M, "output": 2, "cache_read": 5, "cache_write": 7}})
        self.assertEqual(payload["legs"]["implementer"]["usage"],
                         {"input": 7, "output": 0, "cache_read": 0, "cache_write": 0})
        self.assertEqual(sorted(payload["legs"]), sorted(out["usd_by_leg"]))
        self.assertNotIn(ledger.REDACTED, json.dumps(payload, ensure_ascii=False))

    def test_harvest_carries_the_structured_fields(self):
        fields = {"kind": "meter", "story_key": KEY, "epic": 9, "usd": 1.25,
                  "legs": {"session": {"usd": 1.25, "usage": {
                      "input": 1, "output": 2, "cache_read": 3, "cache_write": 4}}},
                  "route": {"session": "model-a"}, "prices_date": "2000-01-01"}
        self.sandbox_observation(KEY, payload={
            "source": "other", "description": f"meter: story={KEY} usd=1.25",
            "evidence": f"transcripts/{KEY}", **fields})
        rc, out = self.run_harvest()
        self.assertEqual(rc, 0, out)
        lines = self.ledger_lines()
        self.assertEqual(len(lines), 1)
        payload = lines[0]["payload"]
        self.assertEqual(payload["description"], f"meter: story={KEY} usd=1.25")
        for field, value in fields.items():
            self.assertEqual(payload[field], value, field)

    def test_harvest_refuses_a_structured_field_of_the_wrong_type(self):
        self.sandbox_observation(KEY)  # sorts first, valid
        for field, bad in (("usd", "1.0"), ("legs", [1]), ("epic", True),
                           ("route", "model-a"), ("kind", 3)):
            d = self.story_dir(OTHER)
            d.mkdir(parents=True, exist_ok=True)
            path = d / meter.OBSERVATION
            path.write_text(json.dumps({"payload": {
                "source": "other", "description": "x", field: bad}}),
                encoding="utf-8")
            rc, out = self.run_harvest()
            self.assertEqual(rc, 2, (field, out))
            self.assertTrue(out["error"].startswith(
                f"observation {path} is unreadable: payload '{field}'"), out["error"])
            self.assertEqual(self.ledger_lines(), [], field)

    def test_harvest_missing_run_dir_refuses(self):
        gone = self.tmp / "no-such-run"
        rc, out = self.run_harvest(gone)
        self.assertEqual(rc, 2)
        self.assertEqual(out, {"ok": False, "error": f"run dir {gone} does not exist"})

    def test_harvest_seeded_holds_exactly_the_seven_epic_25_keys(self):
        self.assertIsInstance(meter.HARVEST_SEEDED, frozenset)
        self.assertEqual(meter.HARVEST_SEEDED, frozenset({
            "25-1-the-roster-and-the-release-motion-for-every-app",
            "25-2-the-installer-writes-the-skills-dir-plugin",
            "25-3-the-drift-check-and-conformance-read-the-folder-and-the",
            "25-4-the-bootstrap-and-the-meta-cli",
            "25-5-doctor-says-what-is-wrong",
            "25-6-sandboxes-read-the-host-skills-folder",
            "25-7-the-docs-and-the-release-say-the-installer-is-the-way-in",
        }))


if __name__ == "__main__":
    unittest.main()
