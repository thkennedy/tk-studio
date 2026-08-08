"""Tests for proposal drafting from observations (ST-040 acceptance criteria).

Merged `observation` events cluster into proposals/ledger.md entries with the
consolidate-twin row discipline: stable PROP-NNN ids assigned in order and
never reused, impact, status Draft/Under-review/Adopted/Declined, rows
updated in place and never deleted, evidence events named, the candidate
change the observation itself states extracted where it states one, and ISS
cross-links where an observation twins an issues-ledger report. Defect-shaped
events stay consolidate's; drafting triggers nothing beyond the ledger sync
(D1).
"""
from __future__ import annotations

import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import consolidate  # noqa: E402
import evolve  # noqa: E402


def _env(event: str, payload: dict, ts: str = "2026-08-01T10:00:00+00:00",
         user: str = "alice", machine: str = "m1") -> dict:
    return {"ts": ts, "event": event, "user": user, "machine": machine,
            "payload": payload}


def _obs(description: str, ts: str = "2026-08-01T10:00:00+00:00",
         user: str = "alice", machine: str = "m1",
         evidence: str | None = None) -> dict:
    payload: dict = {"source": "other", "description": description}
    if evidence:
        payload["evidence"] = evidence
    return _env("observation", payload, ts=ts, user=user, machine=machine)


_CHURN_A = ("Manual churn: the installer rewrites list-valued config options "
            "as JSON strings on every reinstall, forcing a revert sweep after "
            "verify runs.")
_CHURN_B = ("Installer rewrites list-valued config options as JSON strings "
            "on reinstall; the revert sweep after verify is manual churn.")
_HEADLESS = ("Headless permission denials leave tk-studio-detect asking "
             "questions with no status block. Candidate: add a "
             "denied-permissions case to the conformance suite.")
_TEST_EMIT = "ST-4.4 live verification emit"


class EvolveTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.repo = Path(self._tmp.name) / "repo"
        (self.repo / ".claude-plugin").mkdir(parents=True)
        (self.repo / ".claude-plugin" / "marketplace.json").write_text(
            "{}\n", encoding="utf-8")
        (self.repo / "measurements").mkdir()
        self.ledger = self.repo / "proposals" / "ledger.md"

    def tearDown(self):
        self._tmp.cleanup()

    def _write(self, filename: str, events: list[dict]) -> None:
        (self.repo / "measurements" / filename).write_text(
            "".join(json.dumps(e, ensure_ascii=False) + "\n" for e in events),
            encoding="utf-8")

    def _rows(self) -> dict[str, list[str]]:
        rows = {}
        for line in self.ledger.read_text(encoding="utf-8").splitlines():
            if line.startswith("| PROP-"):
                cells = [c.strip() for c in line.split("|")][1:-1]
                rows[cells[0]] = cells
        return rows

    def _seed(self) -> None:
        self._write("alice-m1.jsonl", [
            _obs(_CHURN_A, ts="2026-08-01T10:00:00+00:00"),
            _obs(_HEADLESS, ts="2026-08-03T09:00:00+00:00"),
            _obs(_TEST_EMIT, ts="2026-08-04T09:00:00+00:00"),
            _env("headless-failure",
                 {"surface": "tk-studio-job", "assertion": "status-block"}),
            _env("install-outcome", {"outcome": "success"}),
        ])
        self._write("bob-m2.jsonl", [
            _obs(_CHURN_B, ts="2026-08-02T11:00:00+00:00",
                 user="bob", machine="m2"),
        ])

    # --- AC 1: observation clusters -> PROP rows with full row discipline

    def test_clusters_create_proposals_with_full_row_discipline(self):
        self._seed()
        result = evolve.draft(self.repo)

        self.assertEqual([c["id"] for c in result["created"]],
                         ["PROP-001", "PROP-002", "PROP-003"])
        self.assertEqual(result["clusters"], 3)
        self.assertEqual(result["observation_events"], 4,
                         "defect-shaped events stay consolidate's")
        rows = self._rows()

        churn = rows["PROP-001"]
        self.assertEqual(churn[1], "High", "cross-machine evidence")
        self.assertEqual(churn[2], "Draft")
        self.assertIn("installer rewrites", churn[3])
        self.assertEqual(churn[4], "2× observation from alice-m1+bob-m2 "
                                   "(2026-08-01..2026-08-02)")
        self.assertTrue(churn[7].startswith("obs:"))
        self.assertEqual(churn[8], "2026-08-01")
        self.assertEqual(churn[9], "2026-08-02")

        headless = rows["PROP-002"]
        self.assertEqual(headless[1], "Low", "single observation")
        self.assertEqual(headless[5],
                         "add a denied-permissions case to the conformance "
                         "suite.", "the candidate the observation states")
        self.assertIn("tk-studio-detect", headless[6])

        emit = rows["PROP-003"]
        self.assertEqual(emit[1], "Low")
        self.assertEqual(emit[5], "", "no candidate invented")
        self.assertEqual(emit[6], "unspecified")

    def test_defect_events_alone_draft_nothing(self):
        self._write("alice-m1.jsonl", [
            _env("headless-failure",
                 {"surface": "tk-studio-job", "assertion": "status-block"}),
            _env("report", {"description": "a defect", "surface": "tk-studio-job"}),
            _env("drift-detection", {"result": "drift"}),
        ])
        result = evolve.draft(self.repo)
        self.assertEqual(result["clusters"], 0)
        self.assertEqual(result["created"], [])
        self.assertFalse(result["wrote"])
        self.assertFalse(self.ledger.exists(),
                         "no observations, no ledger stood up")

    def test_stable_ids_update_in_place_never_delete(self):
        self._seed()
        evolve.draft(self.repo)
        self._write("carol-m3.jsonl", [
            _obs(_CHURN_B, ts="2026-08-05T08:00:00+00:00",
                 user="carol", machine="m3")])

        result = evolve.draft(self.repo)

        self.assertEqual(result["created"], [])
        self.assertEqual(result["updated"], ["PROP-001"])
        self.assertEqual(result["unchanged"], 2)
        rows = self._rows()
        self.assertEqual(len(rows), 3, "no row added or deleted")
        self.assertTrue(rows["PROP-001"][4].startswith("3× observation"))
        self.assertIn("carol-m3", rows["PROP-001"][4])
        self.assertEqual(rows["PROP-001"][9], "2026-08-05")

    def test_operator_owned_columns_survive_updates(self):
        self._seed()
        evolve.draft(self.repo)
        lines = self.ledger.read_text(encoding="utf-8").splitlines()
        for index, line in enumerate(lines):
            if line.startswith("| PROP-001"):
                cells = [c.strip() for c in line.split("|")][1:-1]
                cells[1], cells[2], cells[5] = "Low", "Adopted", "my own plan"
                lines[index] = "| " + " | ".join(cells) + " |"
        self.ledger.write_text("\n".join(lines) + "\n", encoding="utf-8")
        self._write("carol-m3.jsonl", [
            _obs(_CHURN_B, ts="2026-08-06T08:00:00+00:00",
                 user="carol", machine="m3")])

        evolve.draft(self.repo)

        row = self._rows()["PROP-001"]
        self.assertEqual(row[1], "Low")
        self.assertEqual(row[2], "Adopted")
        self.assertEqual(row[5], "my own plan",
                         "a hand-edited candidate is never overwritten")
        self.assertTrue(row[4].startswith("3×"), "evidence still updates")

    def test_machine_written_candidate_upgrades_when_evidence_states_one(self):
        self._write("alice-m1.jsonl", [_obs(_TEST_EMIT)])
        evolve.draft(self.repo)
        self.assertEqual(self._rows()["PROP-001"][5], "")
        self._write("bob-m2.jsonl", [
            _obs(_TEST_EMIT + " repeats. Candidate: gate live-verification "
                 "emits behind a flag.",
                 ts="2026-08-02T10:00:00+00:00", user="bob", machine="m2")])

        evolve.draft(self.repo)

        self.assertEqual(self._rows()["PROP-001"][5],
                         "gate live-verification emits behind a flag.",
                         "an empty machine cell upgrades to the stated candidate")

    # --- cross-links to the issues ledger

    def _issues_ledger(self, key: str) -> None:
        path = self.repo / "issues" / "ledger.md"
        path.parent.mkdir()
        path.write_text(
            consolidate._LEDGER_TEMPLATE
            + f"| ISS-001 | Medium | Open | Twin issue | Expected: x. Actual: y "
              f"| 1× report from alice-m1 (2026-08-01) | | {key} | 2026-08-01 "
              "| 2026-08-01 |\n",
            encoding="utf-8")

    def test_observation_twinning_a_report_names_the_iss_row(self):
        self._issues_ledger("report:tk-studio-detect")
        self._write("alice-m1.jsonl", [
            _obs(_HEADLESS),
            _env("report", {"description": "detect asks questions headless",
                            "surface": "tk-studio-detect"},
                 ts="2026-08-02T10:00:00+00:00"),
        ])

        result = evolve.draft(self.repo)

        row = self._rows()["PROP-001"]
        self.assertIn("↔ ISS-001", row[4], "evidence names the twin issue")
        self.assertEqual(row[1], "Medium",
                         "an issues-ledger twin lifts a single observation")
        self.assertEqual(result["created"][0]["impact"], "Medium")

    def test_token_similar_report_links_without_a_named_surface(self):
        # the installer-churn pattern: the report's surface never appears in
        # the observation text; the twin is found by shared toil language
        self._issues_ledger("report:tk-studio-base-update")
        self._write("alice-m1.jsonl", [
            _obs(_CHURN_A),
            _env("report", {"description": _CHURN_B,
                            "surface": "tk-studio-base-update"},
                 ts="2026-08-02T10:00:00+00:00"),
        ])
        evolve.draft(self.repo)
        self.assertIn("↔ ISS-001", self._rows()["PROP-001"][4])

    def test_unrelated_surfaceless_report_does_not_link(self):
        self._issues_ledger("report:unspecified")
        self._write("alice-m1.jsonl", [
            _obs(_TEST_EMIT),
            _env("report", {"description": "completely different defect"},
                 ts="2026-08-02T10:00:00+00:00"),
        ])
        evolve.draft(self.repo)
        self.assertNotIn("↔", self._rows()["PROP-001"][4])

    # --- idempotence, id allocation, seed reordering, refusals

    def test_rerun_without_new_data_changes_nothing(self):
        self._seed()
        evolve.draft(self.repo)
        before = self.ledger.read_bytes()
        result = evolve.draft(self.repo)
        self.assertEqual(result["created"], [])
        self.assertEqual(result["updated"], [])
        self.assertFalse(result["wrote"])
        self.assertEqual(self.ledger.read_bytes(), before)

    def test_ids_assigned_after_the_highest_ever_used(self):
        self.ledger.parent.mkdir()
        self.ledger.write_text(
            evolve._LEDGER_TEMPLATE
            + "| PROP-007 | Low | Declined | Hand-written proposal | operator "
              "note | | | manual:thing | 2026-07-01 | 2026-07-01 |\n",
            encoding="utf-8")
        self._write("alice-m1.jsonl", [_obs(_CHURN_A)])

        result = evolve.draft(self.repo)

        self.assertEqual([c["id"] for c in result["created"]], ["PROP-008"])
        rows = self._rows()
        self.assertEqual(rows["PROP-007"][3], "Hand-written proposal",
                         "existing rows are never deleted or renumbered")

    def test_merged_earlier_evidence_reordering_the_seed_keeps_the_row(self):
        # bob's file arrives first; alice's earlier twin merges later and
        # becomes the cluster seed — the rerun must find the existing row by
        # a member key, not strand it and mint a duplicate
        self._write("bob-m2.jsonl", [
            _obs(_CHURN_B, ts="2026-08-02T11:00:00+00:00",
                 user="bob", machine="m2")])
        evolve.draft(self.repo)
        original_key = self._rows()["PROP-001"][7]
        self._write("alice-m1.jsonl", [
            _obs(_CHURN_A, ts="2026-08-01T10:00:00+00:00")])

        result = evolve.draft(self.repo)

        self.assertEqual(result["created"], [])
        self.assertEqual(result["updated"], ["PROP-001"])
        rows = self._rows()
        self.assertEqual(len(rows), 1, "no duplicate row minted")
        self.assertEqual(rows["PROP-001"][7], original_key,
                         "the Key cell is never rewritten")
        self.assertTrue(rows["PROP-001"][4].startswith("2× observation"))
        self.assertEqual(rows["PROP-001"][8], "2026-08-01",
                         "Opened reflects the earliest evidence")

    def test_distinct_clusters_never_collide_on_a_key(self):
        # two token-empty observations slug to the same readable head; the
        # identity digest must keep their keys distinct or every rerun would
        # cross-contaminate the rows and mint a duplicate (review finding,
        # PR #24)
        self._write("alice-m1.jsonl", [
            _obs("is it ok?", ts="2026-08-01T10:00:00+00:00"),
            _obs("so be it", ts="2026-08-02T10:00:00+00:00"),
        ])
        result = evolve.draft(self.repo)
        self.assertEqual(len(result["created"]), 2)
        rows = self._rows()
        self.assertNotEqual(rows["PROP-001"][7], rows["PROP-002"][7],
                            "keys stay distinct across dissimilar clusters")
        before = self.ledger.read_bytes()

        result = evolve.draft(self.repo)

        self.assertEqual(result["created"], [])
        self.assertEqual(result["updated"], [])
        self.assertEqual(self.ledger.read_bytes(), before,
                         "rerun mints no duplicate and rewrites nothing")

    def test_cluster_merge_reports_the_stranded_row(self):
        # a later-merged earlier event similar to both seeds fuses two
        # clusters; the row the fused cluster does not claim is stranded —
        # never deleted, but the run must name it for the operator
        self._write("alice-m1.jsonl", [
            _obs("alpha bravo charlie delta", ts="2026-08-02T10:00:00+00:00"),
            _obs("echo foxtrot golf hotel", ts="2026-08-03T10:00:00+00:00"),
        ])
        first = evolve.draft(self.repo)
        self.assertEqual(len(first["created"]), 2)
        self.assertEqual(first["stranded"], [])
        self._write("bob-m2.jsonl", [
            _obs("alpha bravo charlie delta echo foxtrot golf hotel",
                 ts="2026-08-01T09:00:00+00:00", user="bob", machine="m2")])

        result = evolve.draft(self.repo)

        self.assertEqual(result["created"], [], "no duplicate row minted")
        self.assertEqual(result["updated"], ["PROP-001"])
        self.assertEqual(result["stranded"], ["PROP-002"])
        rows = self._rows()
        self.assertEqual(len(rows), 2, "the stranded row is never deleted")

    def test_candidate_extracted_from_a_multiline_description(self):
        self._write("alice-m1.jsonl", [
            _obs("Toil observed in verify.\nCandidate: normalize the verify "
                 "step.\nSeen twice this week.")])
        evolve.draft(self.repo)
        self.assertEqual(self._rows()["PROP-001"][5],
                         "normalize the verify step.")

    def test_dry_run_writes_nothing(self):
        self._seed()
        result = evolve.draft(self.repo, dry_run=True)
        self.assertEqual(len(result["created"]), 3)
        self.assertFalse(result["wrote"])
        self.assertFalse(self.ledger.exists())

    def test_no_measurements_dir_is_a_clean_noop(self):
        elsewhere = Path(self._tmp.name) / "elsewhere"
        elsewhere.mkdir()
        stdout = io.StringIO()
        with contextlib.redirect_stdout(stdout):
            code = evolve.main(["draft", "--directory", str(elsewhere),
                                "--dry-run"])
        self.assertEqual(code, 0)
        out = json.loads(stdout.getvalue())
        self.assertTrue(out["ok"])
        self.assertEqual(out["events_scanned"], 0)

    def test_measurements_outside_studio_repo_blocked(self):
        elsewhere = Path(self._tmp.name) / "elsewhere"
        (elsewhere / "measurements").mkdir(parents=True)
        with self.assertRaises(evolve.EvolveBlocked) as ctx:
            evolve.draft(elsewhere)
        self.assertEqual(ctx.exception.step, "preflight")

    def test_missing_directory_blocked_headless_clean(self):
        stdout = io.StringIO()
        with contextlib.redirect_stdout(stdout):
            code = evolve.main(
                ["draft", "--directory", str(Path(self._tmp.name) / "nowhere")])
        self.assertEqual(code, 2)
        out = json.loads(stdout.getvalue())
        self.assertFalse(out["ok"])
        self.assertIn("does not exist", out["error"])

    def test_unparseable_ledger_row_blocks_rather_than_guessing(self):
        self.ledger.parent.mkdir()
        self.ledger.write_text(
            evolve._LEDGER_TEMPLATE + "| PROP-001 | mangled row |\n",
            encoding="utf-8")
        self._write("alice-m1.jsonl", [_obs(_CHURN_A)])
        with self.assertRaises(evolve.EvolveBlocked) as ctx:
            evolve.draft(self.repo)
        self.assertEqual(ctx.exception.step, "ledger-parse")

    def test_headerless_ledger_blocks(self):
        self.ledger.parent.mkdir()
        self.ledger.write_text("# Someone replaced the ledger\n",
                               encoding="utf-8")
        self._write("alice-m1.jsonl", [_obs(_CHURN_A)])
        with self.assertRaises(evolve.EvolveBlocked) as ctx:
            evolve.draft(self.repo)
        self.assertEqual(ctx.exception.step, "ledger-parse")

    # --- status (read-only)

    def test_status_before_any_draft(self):
        stdout = io.StringIO()
        with contextlib.redirect_stdout(stdout):
            code = evolve.main(["status", "--directory", str(self.repo)])
        self.assertEqual(code, 0)
        out = json.loads(stdout.getvalue())
        self.assertTrue(out["ok"])
        self.assertEqual(out["rows"], 0)

    def test_status_counts_rows_by_status(self):
        self._seed()
        evolve.draft(self.repo)
        out = evolve.status(self.repo)
        self.assertEqual(out["rows"], 3)
        self.assertEqual(out["by_status"], {"Draft": 3})
        self.assertEqual(out["proposals"][0]["id"], "PROP-001")


if __name__ == "__main__":
    unittest.main()
