"""Story 37.1: the ledger's one parser, its refusal and the real ledger.

The engine's gate runs this module (`pipeline/verify-commands.toml`) and the host
leg runs it with the lib suite, so a duplicate heading goes red on both.
"""
from __future__ import annotations

import re
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import _core  # noqa: E402
import dwledger  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[4]
REAL_LEDGER = REPO_ROOT / "_bmad-output" / "implementation-artifacts" / "deferred-work.md"
DOC = """# Deferred Work

### DW-1: first
origin: x
status: open

## Deferred from: elsewhere

### DW-2: second
reason: see DW-9
status: resolved 2026-11-02 by Story 37.1 (duplicate of DW-1)

### DW-3: no status
reason: r
"""


def engine_next_seq(text: str) -> int:
    """The engine's `deferredwork.next_seq` (upstream, never imported here)."""
    nums = [int(m.group(1)) for m in re.finditer(r"\bDW-(\d+)\b", text)]
    return (max(nums) + 1) if nums else 1


class ParseTests(unittest.TestCase):
    def test_entries_carry_id_line_span_and_status(self):
        entries = dwledger.parse_ledger(DOC)
        self.assertEqual([(e.id, e.line) for e in entries], [("DW-1", 3), ("DW-2", 9), ("DW-3", 13)])
        self.assertEqual([e.status.split()[0] if e.status else None for e in entries],
                         ["open", "resolved", None])
        # an entry ends at the next heading of any level
        self.assertTrue(DOC[entries[0].start:entries[0].end].endswith("status: open\n\n"))
        self.assertTrue(DOC[entries[2].start:entries[2].end].endswith("reason: r\n"))

    def test_a_duplicate_heading_is_refused_naming_both_lines(self):
        text = DOC + "\n### DW-2: again\nstatus: open\n"
        with self.assertRaises(dwledger.LedgerDuplicateId) as caught:
            dwledger.parse_ledger(text)
        self.assertEqual(str(caught.exception), "LedgerDuplicateId: DW-2 at lines 9 and 16")
        self.assertIsInstance(caught.exception, _core.Refusal)

    def test_an_id_in_body_text_is_no_heading(self):
        self.assertEqual(len(dwledger.parse_ledger(DOC + "\nsee DW-1: again\n#### DW-1: nope\n")), 3)

    def test_highest_id_reads_headings_body_and_marker(self):
        self.assertEqual(dwledger.highest_id("# none\n"), 0)
        self.assertEqual(dwledger.highest_id(DOC), 9)
        self.assertEqual(dwledger.highest_id(dwledger.with_marker(DOC, 40)), 40)


class MarkerTests(unittest.TestCase):
    def test_the_line_reads_as_the_contract_states(self):
        self.assertEqual(dwledger.marker_line(165), "<!-- deferred-work counter: last minted DW-165; "
                                                    "mint through plansync.py deferred mint -->")

    def test_it_lands_under_the_title_and_then_replaces_itself(self):
        once = dwledger.with_marker(DOC, 165)
        self.assertTrue(once.startswith(f"# Deferred Work\n\n{dwledger.marker_line(165)}\n\n### DW-1: first"))
        twice = dwledger.with_marker(once, 170)
        self.assertEqual(twice, once.replace("DW-165;", "DW-170;"))
        self.assertEqual(dwledger.with_marker("### DW-1: a\n", 1), f"{dwledger.marker_line(1)}\n\n### DW-1: a\n")
        self.assertEqual(dwledger.with_marker("# T", 1), f"# T\n\n{dwledger.marker_line(1)}\n\n")

    def test_the_marker_is_inert_for_the_parser_and_read_by_the_engines_next_seq(self):
        marked = dwledger.with_marker(DOC, 165)
        self.assertEqual([e.id for e in dwledger.parse_ledger(marked)], ["DW-1", "DW-2", "DW-3"])
        self.assertEqual(engine_next_seq(marked), 166)
        self.assertEqual(engine_next_seq(DOC), 10)


class RealLedgerTests(unittest.TestCase):
    """The tracked ledger parses, and a duplicate planted in a copy is refused by name."""

    @classmethod
    def setUpClass(cls):
        cls.text = REAL_LEDGER.read_text(encoding="utf-8")

    def test_it_parses_with_no_duplicate(self):
        self.assertTrue(dwledger.parse_ledger(self.text))

    def test_a_planted_duplicate_in_a_copy_names_both_lines(self):
        first = dwledger.parse_ledger(self.text)[0]
        lines = self.text.count("\n")
        planted = self.text.rstrip("\n") + f"\n\n### {first.id}: planted\nstatus: open\n"
        with self.assertRaises(dwledger.LedgerDuplicateId) as caught:
            dwledger.parse_ledger(planted)
        self.assertEqual(str(caught.exception),
                         f"LedgerDuplicateId: {first.id} at lines {first.line} and {lines + 2}")


if __name__ == "__main__":
    unittest.main()
