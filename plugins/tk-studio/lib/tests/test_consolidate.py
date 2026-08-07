"""Tests for consolidation into issues (ST-7.2 acceptance criteria).

Merged measurement events cluster into issues/ledger.md entries with the legacy-council
row discipline: stable ISS-NNN ids assigned in order and never reused,
severity, status, expected-vs-actual, rows updated in place and never
deleted, evidence events named, and a specific fix candidate where the
evidence makes one clear — including "revise the distribution mechanism"
when cross-machine evidence points there.
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


def _env(event: str, payload: dict, ts: str = "2026-08-01T10:00:00+00:00",
         user: str = "alice", machine: str = "m1") -> dict:
    return {"ts": ts, "event": event, "user": user, "machine": machine,
            "payload": payload}


class ConsolidateTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.repo = Path(self._tmp.name) / "repo"
        (self.repo / ".claude-plugin").mkdir(parents=True)
        (self.repo / ".claude-plugin" / "marketplace.json").write_text(
            "{}\n", encoding="utf-8")
        (self.repo / "measurements").mkdir()
        self.ledger = self.repo / "issues" / "ledger.md"

    def tearDown(self):
        self._tmp.cleanup()

    def _write(self, filename: str, events: list[dict]) -> None:
        (self.repo / "measurements" / filename).write_text(
            "".join(json.dumps(e) + "\n" for e in events), encoding="utf-8")

    def _rows(self) -> dict[str, list[str]]:
        rows = {}
        for line in self.ledger.read_text(encoding="utf-8").splitlines():
            if line.startswith("| ISS-"):
                cells = [c.strip() for c in line.split("|")][1:-1]
                rows[cells[0]] = cells
        return rows

    def _seed_defects(self) -> None:
        self._write("alice-m1.jsonl", [
            _env("headless-failure",
                 {"surface": "tk-studio-job", "assertion": "status-block",
                  "detail": "no terminal block"},
                 ts="2026-08-01T10:00:00+00:00"),
            _env("headless-failure",
                 {"surface": "tk-studio-job", "assertion": "status-block",
                  "detail": "no terminal block"},
                 ts="2026-08-02T11:00:00+00:00"),
            _env("report", {"description": "sync renumbered a story id",
                            "surface": "tk-studio-plan-sync"},
                 ts="2026-08-03T09:00:00+00:00"),
            _env("observation", {"source": "other", "description": "fine"}),
            _env("install-outcome", {"outcome": "success",
                                     "core_version": "6.10.0"}),
        ])

    # --- AC 1: clusters -> entries with id, severity, status, evidence

    def test_clusters_create_issues_with_full_row_discipline(self):
        self._seed_defects()
        result = consolidate.consolidate(self.repo)

        self.assertEqual([c["id"] for c in result["created"]],
                         ["ISS-001", "ISS-002"])
        self.assertEqual(result["clusters"], 2, "non-defect events ignored")
        rows = self._rows()
        headless = rows["ISS-001"]
        self.assertEqual(headless[1], "High")
        self.assertEqual(headless[2], "Open")
        self.assertIn("tk-studio-job", headless[3])
        self.assertIn("Expected:", headless[4])
        self.assertIn("Actual:", headless[4])
        self.assertEqual(headless[5],
                         "2× headless-failure from alice-m1 "
                         "(2026-08-01..2026-08-02)")
        self.assertIn("status-block", headless[6], "fix candidate is specific")
        self.assertEqual(headless[8], "2026-08-01")
        self.assertEqual(headless[9], "2026-08-02")
        report = rows["ISS-002"]
        self.assertIn("tk-studio-plan-sync", report[3])
        self.assertEqual(report[6], "", "no fix invented for a human report")

    def test_stable_ids_update_in_place_never_delete(self):
        self._seed_defects()
        consolidate.consolidate(self.repo)
        events = [json.loads(line) for line in
                  (self.repo / "measurements" / "alice-m1.jsonl")
                  .read_text(encoding="utf-8").splitlines()]
        events.append(_env("headless-failure",
                           {"surface": "tk-studio-job",
                            "assertion": "status-block"},
                           ts="2026-08-05T08:00:00+00:00"))
        self._write("alice-m1.jsonl", events)

        result = consolidate.consolidate(self.repo)

        self.assertEqual(result["created"], [])
        self.assertEqual(result["updated"], ["ISS-001"])
        self.assertEqual(result["unchanged"], 1)
        rows = self._rows()
        self.assertEqual(len(rows), 2, "no row added or deleted")
        self.assertTrue(rows["ISS-001"][5].startswith("3× headless-failure"))
        self.assertEqual(rows["ISS-001"][9], "2026-08-05")

    def test_operator_owned_columns_survive_updates(self):
        self._seed_defects()
        consolidate.consolidate(self.repo)
        lines = self.ledger.read_text(encoding="utf-8").splitlines()
        for index, line in enumerate(lines):
            if line.startswith("| ISS-001"):
                cells = [c.strip() for c in line.split("|")][1:-1]
                cells[1], cells[2], cells[6] = "Low", "Mitigated", "my own plan"
                lines[index] = "| " + " | ".join(cells) + " |"
        self.ledger.write_text("\n".join(lines) + "\n", encoding="utf-8")
        events = [json.loads(line) for line in
                  (self.repo / "measurements" / "alice-m1.jsonl")
                  .read_text(encoding="utf-8").splitlines()]
        events.append(_env("headless-failure",
                           {"surface": "tk-studio-job",
                            "assertion": "status-block"},
                           ts="2026-08-06T08:00:00+00:00"))
        self._write("alice-m1.jsonl", events)

        consolidate.consolidate(self.repo)

        row = self._rows()["ISS-001"]
        self.assertEqual(row[1], "Low")
        self.assertEqual(row[2], "Mitigated")
        self.assertEqual(row[6], "my own plan",
                         "a hand-edited fix candidate is never overwritten")
        self.assertTrue(row[5].startswith("3×"), "evidence still updates")

    # --- AC 2: fix candidates, incl. the named distribution-mechanism case

    def test_cross_machine_drift_names_the_distribution_mechanism(self):
        self._write("alice-m1.jsonl", [
            _env("drift-detection", {"result": "drift", "planes": [],
                                     "detail": "bmad-base behind pin"})])
        result = consolidate.consolidate(self.repo)
        fix = result["created"][0]["fix_candidate"]
        self.assertIn("guided fix", fix, "single machine: guided fix, not "
                                         "a distribution revision")

        self._write("bob-m2.jsonl", [
            _env("drift-detection", {"result": "drift", "planes": []},
                 ts="2026-08-04T10:00:00+00:00", user="bob", machine="m2")])
        result = consolidate.consolidate(self.repo)

        self.assertEqual(result["updated"], ["ISS-001"])
        row = self._rows()["ISS-001"]
        self.assertIn("revise the distribution mechanism", row[6])
        self.assertIn("alice-m1+bob-m2", row[5], "evidence names both sources")

    # --- idempotence, id allocation, refusals

    def test_rerun_without_new_data_changes_nothing(self):
        self._seed_defects()
        consolidate.consolidate(self.repo)
        before = self.ledger.read_bytes()
        result = consolidate.consolidate(self.repo)
        self.assertEqual(result["created"], [])
        self.assertEqual(result["updated"], [])
        self.assertFalse(result["wrote"])
        self.assertEqual(self.ledger.read_bytes(), before)

    def test_ids_assigned_after_the_highest_ever_used(self):
        self.ledger.parent.mkdir()
        self.ledger.write_text(
            consolidate._LEDGER_TEMPLATE
            + "| ISS-007 | Low | Open | Hand-written issue | Expected: x. "
              "Actual: y | operator observation | | manual:thing | "
              "2026-07-01 | 2026-07-01 |\n",
            encoding="utf-8")
        self._seed_defects()

        result = consolidate.consolidate(self.repo)

        self.assertEqual([c["id"] for c in result["created"]],
                         ["ISS-008", "ISS-009"])
        rows = self._rows()
        self.assertEqual(rows["ISS-007"][3], "Hand-written issue",
                         "existing rows are never deleted or renumbered")

    def test_dry_run_writes_nothing(self):
        self._seed_defects()
        result = consolidate.consolidate(self.repo, dry_run=True)
        self.assertEqual(len(result["created"]), 2)
        self.assertFalse(result["wrote"])
        self.assertFalse(self.ledger.exists())

    def test_no_measurements_dir_is_a_clean_noop(self):
        elsewhere = Path(self._tmp.name) / "elsewhere"
        elsewhere.mkdir()
        stdout = io.StringIO()
        with contextlib.redirect_stdout(stdout):
            code = consolidate.main(["run", "--directory", str(elsewhere),
                                     "--dry-run"])
        self.assertEqual(code, 0)
        out = json.loads(stdout.getvalue())
        self.assertTrue(out["ok"])
        self.assertEqual(out["events_scanned"], 0)

    def test_measurements_outside_studio_repo_blocked(self):
        elsewhere = Path(self._tmp.name) / "elsewhere"
        (elsewhere / "measurements").mkdir(parents=True)
        with self.assertRaises(consolidate.ConsolidateBlocked) as ctx:
            consolidate.consolidate(elsewhere)
        self.assertEqual(ctx.exception.step, "preflight")

    def test_missing_directory_blocked_headless_clean(self):
        stdout = io.StringIO()
        with contextlib.redirect_stdout(stdout):
            code = consolidate.main(
                ["run", "--directory",
                 str(Path(self._tmp.name) / "nowhere")])
        self.assertEqual(code, 2)
        out = json.loads(stdout.getvalue())
        self.assertFalse(out["ok"])
        self.assertIn("does not exist", out["error"])

    def test_unparseable_ledger_row_blocks_rather_than_guessing(self):
        self.ledger.parent.mkdir()
        self.ledger.write_text(
            consolidate._LEDGER_TEMPLATE + "| ISS-001 | mangled row |\n",
            encoding="utf-8")
        self._seed_defects()
        with self.assertRaises(consolidate.ConsolidateBlocked) as ctx:
            consolidate.consolidate(self.repo)
        self.assertEqual(ctx.exception.step, "ledger-parse")

    def test_malformed_measurement_lines_skipped_and_counted(self):
        (self.repo / "measurements" / "alice-m1.jsonl").write_text(
            json.dumps(_env("report", {"description": "real"})) + "\n"
            + "{not json}\n", encoding="utf-8")
        result = consolidate.consolidate(self.repo)
        self.assertEqual(result["skipped_lines"], 1)
        self.assertEqual(len(result["created"]), 1)


if __name__ == "__main__":
    unittest.main()
