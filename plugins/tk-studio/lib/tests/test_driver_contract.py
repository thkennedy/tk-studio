"""Tests for the published driver contract (ST-5.3 acceptance criteria).

The contract is a document; these tests hold its structure to the AC so a
future edit cannot silently drop a required section, the semver line, or a
dossier item's disposition.
"""
from __future__ import annotations

import json
import re
import unittest
from pathlib import Path

PLUGIN_ROOT = Path(__file__).resolve().parents[2]
CONTRACT = PLUGIN_ROOT / "contracts" / "driver-contract.md"
STATUS_SCHEMA = PLUGIN_ROOT / "contracts" / "status-block.schema.json"


class DriverContractTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text = CONTRACT.read_text(encoding="utf-8")

    # --- AC 1: the five required surfaces, each with schema + example

    def test_contract_exists_in_contracts(self):
        self.assertTrue(CONTRACT.is_file())

    def test_covers_per_skill_headless_invocation_surface(self):
        # every shipped studio skill appears in the surface table
        skills_dir = PLUGIN_ROOT / "skills"
        shipped = [p.name for p in skills_dir.iterdir()
                   if p.is_dir() and (p / "SKILL.md").is_file()]
        self.assertTrue(shipped)
        for name in shipped:
            self.assertIn(f"`{name}`", self.text,
                          f"skill {name} missing from the invocation surface")

    def test_covers_status_schema_and_references_the_shipped_file(self):
        self.assertIn("status-block.schema.json", self.text)
        schema = json.loads(STATUS_SCHEMA.read_text(encoding="utf-8"))
        for value in schema["properties"]["status"]["enum"]:
            self.assertIn(value, self.text)

    def test_covers_scheduler_verbs(self):
        for verb in ("submit", "status", "cancel", "wake"):
            self.assertRegex(self.text, rf"`{verb}`",
                             f"scheduler verb {verb} missing")

    def test_covers_model_effort_override_api(self):
        self.assertRegex(
            self.text,
            r"runtime override\s*>\s*project config\s*>\s*resource default")
        self.assertIn("customize.toml", self.text)

    def test_covers_drift_check_invocation(self):
        self.assertIn("drift_check.py", self.text)
        self.assertIn("drift-detection", self.text)

    def test_each_section_carries_an_example_or_schema(self):
        # at least one fenced json/toml/bash block per normative section is
        # approximated by requiring several fenced blocks overall
        self.assertGreaterEqual(len(re.findall(r"```", self.text)), 8)

    # --- AC 1b: own semver + change policy

    def test_carries_its_own_semver_and_change_policy(self):
        # 0.1.1..0.1.7 = ST-6.2/6.4/7.1/7.2/8.1/8.2/9.6 additive surfaces
        # (0.1.7 is the Epic 9 knowledge-port bump; renumbered 2026-08-07
        # from the 1.x line — pre-1.0 semver for a new product, 1.N.0 →
        # 0.1.N, the 0.1 line the compatibility pin); 0.1.8 is the §2
        # clarification patch (detect ask posture, plan-sync partial —
        # chipped at PR #21 review); 0.1.9 adds the tk-studio-evolve
        # surface + the shipped evolve-proposals job type (EP-010, additive)
        self.assertRegex(self.text, r"\*\*0\.1\.9\*\*")
        self.assertIn("Change policy", self.text)
        self.assertIn("MAJOR", self.text)
        self.assertRegex(self.text, r"[Bb]reaking")
        # the renumber mapping stays documented — old references resolve
        self.assertIn("1.N.0 → 0.1.N", self.text)

    # --- 0.1.8: §2 clarifications stay pinned (chipped at PR #21 review)

    def test_detect_row_names_the_ask_outcome_as_blocked(self):
        # the detect core's in-band ask (exit 0) is a refusal, never a
        # downgrade to complete — the §2 row must say so, matching the
        # SKILL.md posture hardened in PR #21 (ISS-002 class)
        row = next(line for line in self.text.splitlines()
                   if line.startswith("| `tk-studio-detect`"))
        self.assertIn("`ask` outcome", row)
        self.assertIn("`blocked`", row)
        self.assertIn("refusal", row)

    def test_plan_sync_row_states_conflicts_end_partial(self):
        # both-changed promote/pull-back conflicts end partial with the
        # conflict list in reason (AD-5) — they were mis-listed as blocked
        row = next(line for line in self.text.splitlines()
                   if line.startswith("| `tk-studio-plan-sync`"))
        self.assertIn("`partial`", row)
        self.assertNotIn("promote/pull-back conflict (human conflict, AD-5)",
                         row)

    # --- ST-042: the 0.1.9 evolve drafting surface is published (EP-010)

    def test_publishes_the_evolve_row(self):
        row = next(line for line in self.text.splitlines()
                   if line.startswith("| `tk-studio-evolve`"))
        self.assertIn("`lib/evolve.py draft\\|status`", row)
        self.assertIn("PROP-NNN", row)
        # the blocked cell names the consolidate-twin refusal family
        self.assertIn("AD-3", row)
        self.assertIn("unparseable proposals ledger", row)
        # D1: documents only — drafting triggers nothing, adoption is human
        self.assertIn("triggers nothing", row)
        # D2: derive-only, no taxonomy event
        self.assertIn("derives, not emits", row)

    # --- ST-9.6: the 0.1.7 knowledge-port surfaces are published

    def test_publishes_the_knowledge_port_rows(self):
        # the §2 rows name their deterministic cores and verbs
        self.assertIn("`lib/session.py handoff\\|resume`", self.text)
        self.assertIn("`lib/promote.py check\\|draft\\|emit`", self.text)
        self.assertIn("`lib/research.py charter\\|record\\|seed\\|spine`",
                      self.text)
        self.assertIn("knowledge.schema.json", self.text)
        self.assertIn("seed.md", self.text)

    def test_publishes_the_kb_injection_directive(self):
        # §4: spine/seed paths named; the injection act stays driver-side
        # (anchor on the section HEADING — the version-table row upstream
        # also says "KB-injection directive" and must not satisfy this)
        section = self.text[self.text.index("### KB-injection directive"):]
        self.assertIn("knowledge/spine.md", section)
        self.assertIn("seed.md", section)
        self.assertIn("driver-side", section)
        self.assertRegex(section, r"[Aa]id, not gate")

    def test_publishes_the_knowledge_promotion_event(self):
        # the taxonomy row and the contract mention land together (D4):
        # ledger.py refuses un-rowed events, so the row must exist
        self.assertIn("knowledge-promotion", self.text)
        taxonomy = json.loads(
            (PLUGIN_ROOT / "contracts" / "events" / "taxonomy.v1.json")
            .read_text(encoding="utf-8"))
        self.assertIn("knowledge-promotion", taxonomy["events"])
        self.assertIn("tk-studio-knowledge",
                      taxonomy["events"]["knowledge-promotion"]["emitter"])

    def test_folds_in_the_deferred_wording(self):
        # DW-1: §4 submit is id-only; DW-3: four-plane + unrunnable-core
        self.assertNotIn("a job definition (or the id", self.text)
        self.assertIn("id-only", self.text)
        self.assertIn("four-plane", self.text)
        self.assertNotIn("three-way", self.text)
        self.assertIn("unrunnable-core", self.text)

    # --- AC 2: A7 dossier items covered or explicitly deferred with a seam

    def test_all_six_dossier_items_have_a_disposition(self):
        section = self.text[self.text.index("integration dossier coverage"):]
        rows = re.findall(r"^\| (\d) \|.+\| \*\*(Covered[^*]*|[Dd]eferred[^*]*)\*\*",
                          section, flags=re.MULTILINE)
        self.assertEqual([r[0] for r in rows], ["1", "2", "3", "4", "5", "6"])

    def test_deferred_items_name_their_seam(self):
        # the port's deferral history stays named (deferred through 0.1.6,
        # landed at 0.1.7) — a reader can trace the seam's closure
        self.assertIn("deferred", self.text.lower())
        self.assertIn("Research→Knowledge Lifecycle", self.text)
        self.assertIn("landed story-by-story as Epic 9", self.text)


if __name__ == "__main__":
    unittest.main()
