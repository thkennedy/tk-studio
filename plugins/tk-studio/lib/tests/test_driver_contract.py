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
        for verb in ("submit", "status", "resolve", "cancel", "wake"):
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
        # surface + the shipped evolve-proposals job type (EP-010, additive);
        # 0.1.10 is the §2 base-update clarification (churn-normalized
        # verify + the verified no-op outcome, EP-011 ST-043); 0.1.11 adds
        # the §8 conformance harness pass (EP-014 ST-051, additive); 0.1.12
        # adds the §4 resolve verb (EP-015 ST-053, PROP-008, additive);
        # 0.1.13 adds the planning adapter's named-write reporting
        # (EP-017 ST-055, PROP-020, additive); 0.1.14 adds the
        # tk-studio-launch surface + the run-epic job type (studio
        # pipeline decision 5, additive); 0.1.15 adds the per-leg
        # execution-pipeline routing (§5.1, lib/pipeline.py, the measured
        # pipeline-v2 defaults — additive); 0.1.16 adds tk-studio-install's
        # optional no_normalize payload and states its churn normalization
        # (the same-pin install no-op fix — additive); 0.1.17 adds the
        # studio-managed base patches (BMAD-METHOD#2718, additive); 0.1.18
        # names the conformant drivers — the studio supervisor and Hermes
        # in place of the retired ClaudeOS, the §1 roster, §2's executing
        # wrapper, the §4 finish row with total_cost_usd (ST-062, additive)
        self.assertRegex(self.text, r"\*\*0\.1\.18\*\*")
        self.assertIn("### 5.1 Execution-pipeline legs", self.text)
        self.assertIn("lib/pipeline.py", self.text)
        self.assertIn("Change policy", self.text)
        self.assertIn("MAJOR", self.text)
        self.assertRegex(self.text, r"[Bb]reaking")
        # the renumber mapping stays documented — old references resolve
        self.assertIn("1.N.0 → 0.1.N", self.text)

    # --- ST-062: 0.1.18 names the supervisor and Hermes

    def _section(self, start: str, end: str) -> str:
        begin = self.text.index(start)
        return self.text[begin:self.text.index(end, begin)]

    def test_0_1_18_names_the_supervisor_and_hermes_in_place_of_claudeos(self):
        # AC1: additive header clause; §7 row 6 names the UI-carrying
        # consumers and still says the studio grows no UI; no row or
        # Audience line names ClaudeOS as the driver
        header = next(line for line in self.text.splitlines()
                      if line.startswith("| **Contract version**"))
        self.assertIn("**0.1.18**", header)
        clause = header[header.index("0.1.18 names"):]
        self.assertIn("— additive", clause)
        audience = next(line for line in self.text.splitlines()
                        if line.startswith("| Audience"))
        self.assertNotIn("ClaudeOS", audience)
        self.assertIn("studio supervisor", audience)
        self.assertIn("Hermes", audience)
        section = self.text[self.text.index("integration dossier coverage"):
                            self.text.index("## 8. Conformance")]
        row6 = next(line for line in section.splitlines()
                    if line.startswith("| 6 |"))
        for phrase in ("studio supervisor", "status page", "Hermes",
                       "front door", "grows no UI"):
            self.assertIn(phrase, row6)
        self.assertNotIn("ClaudeOS", row6)
        for row in (line for line in section.splitlines()
                    if re.match(r"^\| \d \|", line)):
            self.assertNotIn("ClaudeOS plugin", row)
            self.assertNotRegex(row, r"ClaudeOS (as )?first driver(?!.{0,40}retired)")
            self.assertNotIn("ClaudeOS remains", row)
        # every remaining ClaudeOS mention reads as retired or historical
        for line in self.text.splitlines():
            if "ClaudeOS" in line:
                self.assertTrue("retired" in line or "historical" in line,
                                f"ClaudeOS not marked retired/historical: "
                                f"{line[:120]}")

    def test_driver_roster_names_the_three_drivers_and_their_roles(self):
        # AC2: the supervisor executes and serves the status page; Hermes
        # submits and never executes; direct invocation conforms per §1
        roster = self._section("### Driver roster (0.1.18)",
                               "### Auth preflight")
        rows = {line.split("|")[1].strip(): line
                for line in roster.splitlines()
                if line.startswith("| ") and "---" not in line}
        supervisor = rows["the studio supervisor"]
        self.assertIn("executing wrapper", supervisor)
        self.assertIn("status page", supervisor)
        hermes = rows["Hermes"]
        self.assertIn("front door", hermes)
        # DW-6: Hermes hands jobs to the supervisor, which calls submit
        self.assertIn("hands jobs to the studio supervisor", hermes)
        self.assertIn("never executes a run", hermes)
        direct = rows["direct invocation"]
        self.assertIn("conforming driver per §1", direct)
        # the roster sits in §1 (direct invocation is defined there)
        self.assertLess(self.text.index("## 1. Invocation model"),
                        self.text.index("### Driver roster (0.1.18)"))
        self.assertLess(self.text.index("### Driver roster (0.1.18)"),
                        self.text.index("## 2. Skill invocation surface"))

    def test_section_2_names_the_executing_wrapper(self):
        # AC3: whichever conformant driver executed the run's wake is its
        # executing wrapper; account and finish are that wrapper's duty
        section = self._section("## 2. Skill invocation surface",
                                "## 3. JSON status schema")
        statement = " ".join(section.split())
        self.assertIn("the executing wrapper for a run is whichever "
                      "conformant driver", statement)
        # DW-6: the directive comes from wake, or from submit for a
        # one-shot skill-target job; every run has exactly one wrapper
        self.assertIn("executed its `invoke-skill` directive", statement)
        self.assertIn("the one `wake` returns", statement)
        self.assertIn("the one `submit` returns", statement)
        self.assertIn("exactly one executing wrapper", statement)
        self.assertIn("`account`", statement)
        self.assertIn("`finish`", statement)
        self.assertIn("are that wrapper's duty", statement)

    def test_section_1_cross_refs_and_the_finish_row(self):
        # AC4: §1 points to §2 for the per-skill CLIs and §3 for the
        # status block; §4 documents finish with the optional cost
        section = " ".join(self._section("## 1. Invocation model",
                                         "## 2. Skill invocation surface")
                           .split())
        self.assertIn("listed per skill in §2", section)
        self.assertIn("status block** (§3)", section)
        self.assertNotIn("status block** (§4)", section)
        self.assertNotIn("listed per skill in §3", section)
        section_4 = self._section("## 4. Job model and scheduler verbs",
                                  "## 5. Model & effort override API")
        row = next(line for line in section_4.splitlines()
                   if line.startswith("| `finish`"))
        self.assertIn("total_cost_usd?", row)
        self.assertIn("--total-cost-usd", row)
        self.assertIn("optional", row)
        self.assertIn("never zero-filled", row)
        self.assertIn("refused by name before anything is written", row)
        self.assertIn("One `job-run` event per terminal transition", row)
        self.assertIn("non-negative", row)
        self.assertIn("finite", row)
        self.assertIn("--directory DIR", row)
        wake = next(line for line in section_4.splitlines()
                    if line.startswith("| `wake`"))
        self.assertEqual(len(re.split(r"(?<!\\)\|", row)),
                         len(re.split(r"(?<!\\)\|", wake)))

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

    # --- ST-055: the 0.1.13 named-write reporting stays published (EP-017)

    def test_plan_sync_row_names_every_written_file(self):
        # PROP-020: the result names every file the run wrote — written[]
        # plus normalize.counter — so staging derives from the response alone
        row = next(line for line in self.text.splitlines()
                   if line.startswith("| `tk-studio-plan-sync`"))
        self.assertIn("`written[]`", row)
        self.assertIn("`normalize.counter`", row)
        self.assertIn("every file the run wrote", row)

    # --- 0.1.16: tk-studio-install's churn normalization stays published

    def test_install_row_names_normalization_and_its_opt_out(self):
        # a verified same-pin install normalizes the reinstall's provable
        # churn in the project tree — a working-tree side effect a driver
        # must be able to see and to turn off
        row = next(line for line in self.text.splitlines()
                   if line.startswith("| `tk-studio-install`"))
        self.assertIn("`no_normalize?`", row)
        self.assertIn("`normalized`", row)
        self.assertIn("`remaining`", row)
        self.assertIn("dirty before the run are never touched", row)

    # --- 0.1.17: studio-managed base patches stay published

    def test_install_row_names_base_patches_never_blind(self):
        # a reinstall must never silently revert a studio fix to an
        # installer-owned file, and a patch must never land on changed text
        row = next(line for line in self.text.splitlines()
                   if line.startswith("| `tk-studio-install`"))
        self.assertIn("`base_patches`", row)
        self.assertIn("never blind", row)
        activate = next(line for line in self.text.splitlines()
                        if line.startswith("| `tk-studio-activate`"))
        self.assertIn("base patch", activate)

    # --- ST-043: the 0.1.10 base-update clarification stays pinned (EP-011)

    def test_base_update_row_names_the_churn_normalized_no_op(self):
        # D2: the install diff commits churn-normalized, counts in the
        # result JSON; D3: an empty post-normalization diff on a same-version
        # re-affirmation ends complete — no branch pushed, no PR opened
        row = next(line for line in self.text.splitlines()
                   if line.startswith("| `tk-studio-base-update`"))
        self.assertIn("`normalized`", row)
        self.assertIn("churn-only", row)
        self.assertIn("verified no-op", row)
        self.assertIn("`complete`", row)
        self.assertIn("no PR opened", row)

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

    # --- ST-051: the 0.1.11 §8 harness pass stays published (EP-014)

    def test_publishes_the_harness_pass(self):
        # anchor on §8's body, not the version-history line upstream
        section = self.text[self.text.index("## 8. Conformance"):]
        self.assertIn("harness pass", section)
        self.assertIn("harness-blocked", section)
        self.assertIn("--harness", section)
        self.assertIn("harness_pass", section)
        self.assertIn("spend-bearing", section)
        # the judged shape: blocked block, surface intent, reason names core
        self.assertIn("naming the unrunnable core", section)
        # the opt-in posture is never a silent cap
        self.assertIn("never a silent cap", section)
        # the shipped case is named with its denying profile
        self.assertIn("tk-studio-detect", section)
        self.assertIn("harness-deny-core.settings.json", section)

    # --- ST-053: the 0.1.12 §4 resolve verb stays published (EP-015)

    def test_publishes_the_resolve_verb(self):
        # the §4 row: request/response shape, read-only, type extension
        # studio-side — drivers never merge or raw-read instance files
        row = next(line for line in self.text.splitlines()
                   if line.startswith("| `resolve`"))
        self.assertIn("{job_id?}", row)
        self.assertIn("resolved", row)
        self.assertIn("read-only", row)
        self.assertIn("one resolver", row)
        self.assertIn("PROP-008", row)
        self.assertIn("named refusal", row)
        # the §2 tk-studio-job row names the verb in payload and core
        job_row = next(line for line in self.text.splitlines()
                       if line.startswith("| `tk-studio-job`"))
        self.assertIn("resolve", job_row)
        # the driver guarantee: raw instance files are not a driver surface
        self.assertIn("not a driver surface", self.text)

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
