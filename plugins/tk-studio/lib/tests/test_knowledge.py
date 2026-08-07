"""Tests for the knowledge core — spine/seed/delta validation (ST-9.1).

Every unit case from the first driver's validator suite (ClaudeOS
`knowledge-schema.test.ts`) is ported here against studio shapes: `project`
replaces `mission`, `run_id` replaces `goal`, the delta tier vocabulary is
`run-local|spine` (was `mg-local|spine`), deltas are structured objects
(the handoff shape) instead of markdown list items, and the spine carries
no budget field (budget rides the authoring job's guards). The supersede
header and anchor grammar are byte-identical to the source contract.

AC under test:
  - accepts a valid seed + valid anchored deltas (and a valid spine)
  - REJECTS an unanchored delta (named rejection, never dropped)
  - REJECTS a seed missing the supersede header
  - REJECTS a delta citing a non-existent (dangling) anchor
"""
from __future__ import annotations

import json
import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import knowledge  # noqa: E402

RUN = "r-20260807-abc123"

VALID_SPINE = """\
---
tier: spine
project: tk-studio
status: provisional
authority: mission-scoped-supersedes-canonical
generated: 2026-08-07T04:00:00Z
---

# SPINE — tk-studio

> Provisional, project-scoped. Authoritative for runs (supersedes canonical
> here); canonical remains kb/. Promotion is the PR gate.

## Systems / entry points

- **[SPINE-A1] job wrapper** — spawns runs and threads handoffs between
  sessions. `lib/jobrun.py:1` — **A**
- **[SPINE-A2] handoff artifact** — the latest handoff a fresh session
  reads. `lib/session.py:1` — **A**

## Invariants

- **[SPINE-A3] canonical is never auto-written** — promotion into kb/ is
  human-gated (PR review). **A**
"""

VALID_SEED = f"""\
---
tier: seed
project: tk-studio
run_id: {RUN}
status: provisional
authority: mission-scoped-supersedes-canonical
spine_ref: knowledge/spine.md
generated: 2026-08-07T04:30:00Z
inherits: [SPINE-A1, SPINE-A3]
---

# SEED — tk-studio / {RUN}

> Provisional, run-scoped. Supersedes canonical for THIS run only.

## Systems / entry points

- **[SEED-{RUN}-A1] knowledge validator** — the pure validator lives in
  `lib/knowledge.py`; every session reads spine+seed through this contract.
  `lib/knowledge.py:1` — **A**
- Builds directly on the wrapper's handoff plumbing. **C** (chain:
  SPINE-A1 → seed injection)

## Invariants

- **[SEED-{RUN}-A2] the supersede header is mandatory** — a seed missing
  `authority: mission-scoped-supersedes-canonical` is rejected. **A**

## Assumptions (explicit)

- **[SEED-{RUN}-A3] anchor ids are immutable** — append-only; a delta cites
  an id, never a line number. **D** — confirmed by the dangling-anchor test.
"""

# Invalid on purpose: omits the mandatory `authority` supersede line.
MISSING_SUPERSEDE = VALID_SEED.replace(
    "authority: mission-scoped-supersedes-canonical\n", "")

VALID_DELTAS = [
    {"anchor": f"SEED-{RUN}-A3", "verdict": "WRONG",
     "reality": "anchor ids survive a renumber via a stable id map, so the "
                "assumption was too strong",
     "evidence": "lib/knowledge.py:88", "tier": "run-local"},
    {"anchor": "SPINE-A1", "verdict": "STALE",
     "reality": "the handoff plumbing moved to a dedicated module during "
                "this run",
     "evidence": "lib/session.py:200", "tier": "spine"},
]

UNANCHORED_DELTA = [
    {"verdict": "WRONG",
     "reality": "this entry cites NO anchor id, so it must be rejected as "
                "unanchored",
     "evidence": "lib/knowledge.py:42", "tier": "run-local"},
]

DANGLING_DELTA = [
    {"anchor": f"SEED-{RUN}-A9", "verdict": "WRONG",
     "reality": "cites anchor A9, which the seed never defines",
     "evidence": "nowhere.py:1", "tier": "run-local"},
]


class ValidateSeedAcceptanceTestCase(unittest.TestCase):
    def test_accepts_a_valid_seed(self):
        result = knowledge.validate_seed(VALID_SEED)
        self.assertEqual(result["errors"], [])
        self.assertTrue(result["valid"])

    def test_accepts_a_valid_spine_the_broad_tier(self):
        result = knowledge.validate_seed(VALID_SPINE)
        self.assertEqual(result["errors"], [])
        self.assertTrue(result["valid"])

    def test_accepts_a_bom_prefixed_artifact(self):
        # Artifacts cross Windows consoles; BOMs must not hide frontmatter —
        # including a double BOM (re-encoding artifact) or whitespace-BOM mix.
        for prefix in ("﻿", "﻿﻿", "\n﻿"):
            result = knowledge.validate_seed(prefix + VALID_SPINE)
            self.assertEqual(result["errors"], [])

    def test_bare_anchor_id_grammar(self):
        # The citation form (ST-9.3): what deltas and finding anchors carry.
        self.assertTrue(knowledge.is_anchor_id("SPINE-A1"))
        self.assertTrue(knowledge.is_anchor_id(f"SEED-{RUN}-A2"))
        self.assertTrue(knowledge.is_anchor_id("SEED-A3"))
        for bad in ("", "SPINE-A", "[SPINE-A1]", "SEED-A1x", "spine-A1",
                    "SPINE-A1 ", None, 3):
            self.assertFalse(knowledge.is_anchor_id(bad))


class ValidateSeedRejectionTestCase(unittest.TestCase):
    def test_rejects_a_seed_missing_the_supersede_header(self):
        result = knowledge.validate_seed(MISSING_SUPERSEDE)
        self.assertFalse(result["valid"])
        self.assertTrue(any("supersede header" in e and "authority" in e
                            for e in result["errors"]))

    def test_rejects_a_seed_with_no_frontmatter(self):
        result = knowledge.validate_seed(
            "# just a heading\n\n- **[SEED-x-A1] thing** — foo. **A**")
        self.assertFalse(result["valid"])
        self.assertIn("frontmatter", result["errors"][0])

    def test_rejects_a_seed_with_a_non_provisional_status(self):
        result = knowledge.validate_seed(
            VALID_SEED.replace("status: provisional", "status: canonical"))
        self.assertFalse(result["valid"])
        self.assertTrue(any("status" in e for e in result["errors"]))

    def test_rejects_a_seed_tier_missing_run_id_and_spine_ref(self):
        stripped = VALID_SEED.replace(f"run_id: {RUN}\n", "") \
                             .replace("spine_ref: knowledge/spine.md\n", "")
        result = knowledge.validate_seed(stripped)
        self.assertFalse(result["valid"])
        self.assertTrue(any("run_id" in e for e in result["errors"]))
        self.assertTrue(any("spine_ref" in e for e in result["errors"]))

    def test_rejects_a_seed_with_a_non_iso_generated_timestamp(self):
        result = knowledge.validate_seed(VALID_SEED.replace(
            "generated: 2026-08-07T04:30:00Z", "generated: August 7th"))
        self.assertFalse(result["valid"])
        self.assertTrue(any("ISO-8601" in e for e in result["errors"]))

    def test_rejects_a_seed_with_a_duplicate_anchor_id(self):
        dupe = VALID_SEED.replace(
            f"SEED-{RUN}-A3] anchor ids are immutable",
            f"SEED-{RUN}-A1] anchor ids are immutable")
        result = knowledge.validate_seed(dupe)
        self.assertFalse(result["valid"])
        self.assertTrue(any("duplicate anchor" in e
                            for e in result["errors"]))

    def test_reports_a_duplicate_id_once_regardless_of_repeats(self):
        tripled = VALID_SPINE + "\n- [SPINE-A1] again\n- [SPINE-A1] and again\n"
        result = knowledge.validate_seed(tripled)
        duplicate_errors = [e for e in result["errors"]
                            if "duplicate" in e and "SPINE-A1" in e]
        self.assertEqual(len(duplicate_errors), 1)

    def test_rejects_a_spine_anchor_without_the_spine_prefix(self):
        wrong = VALID_SPINE.replace("[SPINE-A3]", "[SEED-x-A3]")
        result = knowledge.validate_seed(wrong)
        self.assertFalse(result["valid"])
        self.assertTrue(any("SPINE- prefix" in e for e in result["errors"]))

    def test_rejects_a_seed_anchor_that_is_neither_seed_nor_inherited(self):
        wrong = VALID_SEED.replace(f"[SEED-{RUN}-A2]", "[SPINE-A9]")
        result = knowledge.validate_seed(wrong)
        self.assertFalse(result["valid"])
        self.assertTrue(any("SEED- prefix" in e for e in result["errors"]))


class ValidateDeltasAcceptanceTestCase(unittest.TestCase):
    def test_accepts_valid_anchored_deltas_own_seed_plus_inherited_spine(self):
        result = knowledge.validate_deltas(VALID_DELTAS, VALID_SEED)
        self.assertEqual(result["errors"], [])
        self.assertTrue(result["valid"])


class ValidateDeltasRejectionTestCase(unittest.TestCase):
    def test_rejects_an_unanchored_delta(self):
        result = knowledge.validate_deltas(UNANCHORED_DELTA, VALID_SEED)
        self.assertFalse(result["valid"])
        self.assertTrue(any("unanchored" in e for e in result["errors"]))

    def test_rejects_a_delta_citing_a_dangling_anchor(self):
        result = knowledge.validate_deltas(DANGLING_DELTA, VALID_SEED)
        self.assertFalse(result["valid"])
        self.assertTrue(any("dangling" in e for e in result["errors"]))

    def test_rejects_an_empty_delta_list(self):
        result = knowledge.validate_deltas([], VALID_SEED)
        self.assertFalse(result["valid"])
        self.assertIn("no entries", result["errors"][0])

    def test_rejects_a_non_list(self):
        result = knowledge.validate_deltas({"anchor": "SPINE-A1"}, VALID_SEED)
        self.assertFalse(result["valid"])
        self.assertIn("array", result["errors"][0])

    def test_rejects_a_delta_with_a_missing_verdict(self):
        delta = [{"anchor": f"SEED-{RUN}-A3",
                  "reality": "no verdict here",
                  "evidence": "lib/knowledge.py:1", "tier": "run-local"}]
        result = knowledge.validate_deltas(delta, VALID_SEED)
        self.assertFalse(result["valid"])
        self.assertTrue(any("verdict" in e for e in result["errors"]))

    def test_rejects_a_delta_with_an_invalid_tier(self):
        delta = [dict(VALID_DELTAS[0], tier="global")]
        result = knowledge.validate_deltas(delta, VALID_SEED)
        self.assertFalse(result["valid"])
        self.assertTrue(any("tier" in e for e in result["errors"]))

    def test_rejects_the_source_vocabulary_tier_mg_local(self):
        # The port renamed mg-local → run-local; the old value must reject
        # loudly, not pass silently.
        delta = [dict(VALID_DELTAS[0], tier="mg-local")]
        result = knowledge.validate_deltas(delta, VALID_SEED)
        self.assertFalse(result["valid"])
        self.assertTrue(any("tier" in e for e in result["errors"]))

    def test_rejects_unknown_fields_on_the_closed_shape(self):
        delta = [dict(VALID_DELTAS[0], note="extra")]
        result = knowledge.validate_deltas(delta, VALID_SEED)
        self.assertFalse(result["valid"])
        self.assertTrue(any("unknown field" in e for e in result["errors"]))

    def test_rejects_missing_reality_and_evidence(self):
        delta = [{"anchor": "SPINE-A1", "verdict": "CONFIRMED",
                  "reality": "", "evidence": "", "tier": "spine"}]
        result = knowledge.validate_deltas(delta, VALID_SEED)
        self.assertTrue(any("'reality'" in e for e in result["errors"]))
        self.assertTrue(any("'evidence'" in e for e in result["errors"]))


class ParsingHelpersTestCase(unittest.TestCase):
    def test_extract_anchors_pulls_ids_deduped_in_order(self):
        self.assertEqual(
            knowledge.extract_anchors(
                "[SPINE-A1] x [SEED-r1-A2] y [SPINE-A1] z"),
            ["SPINE-A1", "SEED-r1-A2"])

    def test_parse_seed_exposes_tier_anchors_inherits_available(self):
        parsed = knowledge.parse_seed(VALID_SEED)
        self.assertEqual(parsed["tier"], "seed")
        self.assertIn(f"SEED-{RUN}-A1", parsed["anchors"])
        self.assertEqual(parsed["inherits"], ["SPINE-A1", "SPINE-A3"])
        self.assertIn(f"SEED-{RUN}-A1", parsed["available"])
        self.assertIn("SPINE-A1", parsed["available"])

    def test_supersede_header_constants_are_the_verbatim_contract_values(self):
        self.assertEqual(knowledge.SUPERSEDE_AUTHORITY,
                         "mission-scoped-supersedes-canonical")
        self.assertEqual(knowledge.PROVISIONAL_STATUS, "provisional")

    def test_frontmatter_comments_and_lists_parse(self):
        parsed = knowledge.parse_seed(
            "---\n# a comment line\ntier: spine  # trailing\n"
            "inherits: []\n---\n[SPINE-A1] body\n")
        self.assertEqual(parsed["tier"], "spine")
        self.assertEqual(parsed["inherits"], [])


class ValidateKnowledgeCombinedTestCase(unittest.TestCase):
    def test_accepts_a_valid_seed_plus_valid_deltas_together(self):
        result = knowledge.validate_knowledge(VALID_SEED, VALID_DELTAS)
        self.assertEqual(result["errors"], [])
        self.assertTrue(result["valid"])

    def test_fails_when_either_the_seed_or_the_deltas_are_invalid(self):
        self.assertFalse(knowledge.validate_knowledge(
            MISSING_SUPERSEDE, VALID_DELTAS)["valid"])
        self.assertFalse(knowledge.validate_knowledge(
            VALID_SEED, UNANCHORED_DELTA)["valid"])

    def test_accepts_a_seed_alone_when_no_deltas_supplied(self):
        self.assertTrue(knowledge.validate_knowledge(VALID_SEED)["valid"])


class SchemaDocTestCase(unittest.TestCase):
    """The published schema doc and the validator must not drift."""

    def setUp(self):
        contracts = Path(__file__).resolve().parents[2] / "contracts"
        self.schema = json.loads(
            (contracts / "knowledge.schema.json").read_text(encoding="utf-8"))

    def test_schema_doc_matches_validator_enums(self):
        delta = self.schema["delta"]["fields"]
        self.assertEqual(tuple(delta["verdict"]["enum"]), knowledge.VERDICTS)
        self.assertEqual(tuple(delta["tier"]["enum"]), knowledge.DELTA_TIERS)
        queue = self.schema["queue_line"]["fields"]
        self.assertEqual(tuple(queue["verdict"]["enum"]), knowledge.VERDICTS)
        self.assertEqual(tuple(queue["tier"]["enum"]), knowledge.DELTA_TIERS)
        fm = self.schema["artifact_frontmatter"]["fields"]
        self.assertEqual(fm["status"]["const"], knowledge.PROVISIONAL_STATUS)
        self.assertEqual(fm["authority"]["const"],
                         knowledge.SUPERSEDE_AUTHORITY)
        self.assertEqual(list(fm["tier"]["enum"]), list(knowledge.SEED_TIERS))
        self.assertEqual(self.schema["artifact_frontmatter"]["required"],
                         ["tier", "status", "authority", "project",
                          "generated"])

    def test_schema_doc_anchor_pattern_matches_the_validator(self):
        self.assertEqual(self.schema["anchors"]["pattern"],
                         knowledge.ANCHOR_RE.pattern)

    def test_schema_doc_publishes_the_d1_grade_mapping(self):
        mapping = self.schema["grades"]["mapping"]
        self.assertEqual(mapping["Confirmed"], "A")
        self.assertEqual(mapping["independent-agreement"], "B")
        self.assertEqual(mapping["Deduced"], "C")
        self.assertEqual(mapping["Hypothesized"], "D")

    def test_schema_doc_queue_line_matches_the_validator_keys(self):
        self.assertEqual(tuple(self.schema["queue_line"]["required"]),
                         knowledge.QUEUE_LINE_KEYS)


def _line(**overrides) -> dict:
    line = {"run_id": RUN, "captured_at": "2026-08-07T05:00:00Z",
            "anchor": f"SEED-{RUN}-A1", "verdict": "WRONG",
            "reality": "the adapter also reads the local overlay",
            "evidence": "lib/config.py:81", "tier": "run-local"}
    line.update(overrides)
    return line


class QueueLineTestCase(unittest.TestCase):
    """ST-9.4: the queue-line shape and its dedupe keys, pure."""

    def test_accepts_a_valid_queue_line(self):
        self.assertEqual(knowledge.validate_queue_line(_line()), [])

    def test_rejects_missing_and_malformed_fields(self):
        self.assertTrue(knowledge.validate_queue_line("not-an-object"))
        for bad in (_line(verdict="MAYBE"), _line(tier="global"),
                    _line(anchor="not-an-anchor"), _line(reality="  "),
                    _line(evidence=""), _line(captured_at="yesterday"),
                    _line(run_id=""), _line(extra="field")):
            problems = knowledge.validate_queue_line(bad)
            self.assertTrue(problems, f"expected a rejection for {bad}")

    def test_rejects_control_and_line_separator_characters(self):
        # reality/evidence are single-line pointers: an embedded newline
        # could forge routing-doc sections; U+2028/U+2029/U+0085 would shear
        # the written JSONL line (they split Python's splitlines)
        for bad in (_line(reality="a\nb"), _line(reality="a\u2028b"),
                    _line(reality="a\u2029b"), _line(reality="a\x85b"),
                    _line(evidence="a\rb"), _line(evidence="a\x00b")):
            problems = knowledge.validate_queue_line(bad)
            self.assertTrue(any("control or line-separator" in p
                                for p in problems), f"missed {bad}")
        # the same policy holds at the delta layer (handoff entry point)
        delta = {"anchor": "SPINE-A1", "verdict": "WRONG",
                 "reality": "line one\nline two", "evidence": "x.py:1",
                 "tier": "spine"}
        seed = ("---\ntier: spine\nstatus: provisional\n"
                "authority: mission-scoped-supersedes-canonical\n"
                "project: p\ngenerated: 2026-08-07\n---\n\n[SPINE-A1] a\n")
        verdict = knowledge.validate_deltas([delta], seed)
        self.assertFalse(verdict["valid"])
        self.assertTrue(any("control or line-separator" in e
                            for e in verdict["errors"]))

    def test_dedupe_keys_match_the_schema_quintuple(self):
        line = _line()
        self.assertEqual(knowledge.queue_key(line),
                         (RUN, line["anchor"], "WRONG", line["reality"],
                          "run-local"))
        # evidence and captured_at stay outside the key: re-observing the
        # same correction elsewhere/later is the same correction
        self.assertEqual(knowledge.queue_key(line),
                         knowledge.queue_key(_line(
                             evidence="elsewhere.py:9",
                             captured_at="2027-01-01T00:00:00Z")))
        self.assertNotEqual(knowledge.queue_key(line),
                            knowledge.queue_key(_line(reality="different")))
        # tier is inside the key: a spine-tier escalation of the same
        # correction is a distinct routing event, never a duplicate
        self.assertNotEqual(knowledge.queue_key(line),
                            knowledge.queue_key(_line(tier="spine")))
        self.assertEqual(knowledge.delta_key(line),
                         (line["anchor"], "WRONG", line["reality"],
                          "run-local"))


class RenderRoutingTestCase(unittest.TestCase):
    """ST-9.4: the routing renderer — pure, applies nothing."""

    def test_renders_spine_first_grouped_by_verdict(self):
        doc = knowledge.render_routing(
            [_line(),
             _line(anchor="SPINE-A1", tier="spine", verdict="STALE",
                   reality="the pin moved")],
            "proj", "2026-08-07T05:00:00Z")
        self.assertIn("applies nothing", doc)
        self.assertLess(doc.index("Spine corrections"),
                        doc.index("Run-local corrections"))
        self.assertIn("[SPINE-A1]", doc)
        self.assertIn(f"[SEED-{RUN}-A1]", doc)
        self.assertIn("### STALE", doc)
        self.assertIn("corrections: 2", doc)

    def test_dedupes_on_the_queue_key(self):
        doc = knowledge.render_routing(
            [_line(), _line(captured_at="2027-01-01T00:00:00Z",
                            evidence="elsewhere.py:9")],
            "proj", "2026-08-07T05:00:00Z")
        self.assertIn("corrections: 1", doc)

    def test_surfaces_invalid_lines_never_drops_them(self):
        doc = knowledge.render_routing(
            [], "proj", "2026-08-07T05:00:00Z",
            invalid=[{"line": 3, "error": "not valid JSON"}])
        self.assertIn("never silently dropped", doc)
        self.assertIn("line 3", doc)
        self.assertIn("no valid corrections", doc)

    def test_render_neutralizes_injected_control_characters(self):
        # validation refuses control characters on entry, but a hand-edited
        # queue line must still be unable to forge sections or anchors on
        # the promotion-decision surface (PR #16 review finding)
        hostile = _line(reality="legit claim\n## Spine corrections — "
                                "INJECTED\n### WRONG\n- **[SPINE-A999]** "
                                "fabricated")
        doc = knowledge.render_routing([hostile], "proj",
                                       "2026-08-07T05:00:00Z")
        self.assertNotIn("\n## Spine corrections — INJECTED", doc)
        self.assertNotIn("\n- **[SPINE-A999]**", doc)
        # the payload text survives, flattened onto the entry's own line
        self.assertIn("INJECTED", doc)


if __name__ == "__main__":
    unittest.main()
