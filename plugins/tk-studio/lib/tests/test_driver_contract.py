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
        # wrapper, the §4 finish row with total_cost_usd (ST-062, additive);
        # 0.1.19 moves the drift check's plugin plane to the skills-dir
        # folder and the roster, and adds §8 --from-archive (ST-083, additive);
        # 0.1.20 adds the §8 meta-CLI drive, manifest and report
        # `cli_drives` (ST-085, additive); 0.1.21 states the launch row's
        # block, bootstrap commit and budget check, and §8's surface
        # status-block drives (Story 26.1, additive); 0.1.22 states the
        # §1 nearest-root rule and §6's optional drift-check roots keys
        # (Story 28.2, additive — SPEC's "minor bump" is the change
        # policy's patch position: an additive rule never takes 0.2.0);
        # 0.1.23 is Story 28.6's (main; a merge inserts its clause);
        # 0.1.24 names the studio web as a consumer and documents the
        # supervisor surfaces it reads in §1 (Story 29.4, additive — AD-2:
        # the supervisor's, never the plugin's); 0.1.25 extends the office
        # projection with `reason` and `last_run` (Story 30.4, additive);
        # 0.1.26 opens Epic 31's entry with the planning adapter's `setup`
        # verb (Story 31.2, additive); 0.1.27 opens Epic 32's entry with
        # the engagement record and its states (Story 32.1, additive)
        self.assertRegex(self.text, r"\*\*0\.1\.27\*\*")
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
        # the 0.1.18 clause survives in the history once 0.1.19 heads it
        clause = header[header.index("0.1.18 names"):
                        header.index("0.1.19 moves")]
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

    # --- ST-083: 0.1.19 states the folder-and-roster rule

    def test_0_1_19_header_names_the_folder_and_roster_rule(self):
        header = next(line for line in self.text.splitlines()
                      if line.startswith("| **Contract version**"))
        # the 0.1.19 clause survives in the history once 0.1.20 heads it
        self.assertNotIn("**0.1.18**", header)
        clause = header[header.index("0.1.19 moves"):
                        header.index("0.1.20 adds")]
        self.assertIn("— additive", clause)
        self.assertIn("--from-archive", clause)
        self.assertLess(header.index("0.1.18 names"),
                        header.index("0.1.19 moves"))

    # --- ST-085: 0.1.20 names the conformance suite's meta-CLI drive

    def test_0_1_20_header_names_the_cli_drives(self):
        header = next(line for line in self.text.splitlines()
                      if line.startswith("| **Contract version**"))
        # the 0.1.20 clause survives in the history once 0.1.21 heads it
        self.assertNotIn("**0.1.19**", header)
        clause = header[header.index("0.1.20 adds"):
                        header.index("0.1.21 (Epic 26)")]
        self.assertIn("— additive", clause)
        self.assertIn("`cli_drives`", clause)
        self.assertLess(header.index("0.1.19 moves"),
                        header.index("0.1.20 adds"))

    # --- Story 26.1: 0.1.21 states the launch row's block, bootstrap
    # commit and budget check, and §8's surface status-block drives

    def test_0_1_21_header_and_launch_row(self):
        header = next(line for line in self.text.splitlines()
                      if line.startswith("| **Contract version**"))
        # the 0.1.21 clause survives in the history once 0.1.22 heads it
        self.assertNotIn("**0.1.20**", header)
        clause = header[header.index("0.1.21 (Epic 26)"):
                        header.index("0.1.22 (Story 28.2)")]
        self.assertIn("— additive", clause)
        self.assertIn("allow_budget_mismatch", clause)
        self.assertLess(header.index("0.1.20 adds"),
                        header.index("0.1.21 (Epic 26)"))
        row = next(line for line in self.text.splitlines()
                   if line.startswith("| `tk-studio-launch` |"))
        for phrase in ("loop(epic-<N>): SPEC, manifest and first-story plan "
                       "from the launch bootstrap",
                       "relaunch", "status, intent, artifacts, reason",
                       "budget_mismatch", "allow_budget_mismatch",
                       "max_tokens_per_story", "not_compared",
                       "never edited", "status page"):
            self.assertIn(phrase, row)
        self.assertNotIn("ClaudeOS", row)
        section = " ".join(self.text[self.text.index("## 8. Conformance"):].split())
        for phrase in ("Surface drives may declare `expect: status-block`",
                       "may declare `status`", "fixtures/launch-relaunch/"):
            self.assertIn(phrase, section)

    # --- Story 26.3: the §5.1 advisor field and pairing rule, appended to
    # the 0.1.21 clause (no bump)

    def test_0_1_21_advisor_clause_and_section_5_1(self):
        header = next(line for line in self.text.splitlines()
                      if line.startswith("| **Contract version**"))
        # the 0.1.21 clause survives in the history once 0.1.22 heads it
        self.assertNotIn("**0.1.21**", header)
        self.assertLess(header.index("0.1.21 (Epic 26)"),
                        header.index("0.1.21 (Story 26.3)"))
        clause = header[header.index("0.1.21 (Story 26.3)"):
                        header.index("0.1.21 (Story 26.5)")]
        for phrase in ("optional `advisor`", "the pairing rule",
                       "the advisor must rank at or above the leg's model",
                       "`--advisor <value>`", "`inherited-session`", "— additive"):
            self.assertIn(phrase, clause)
        section = " ".join(self.text[self.text.index("### 5.1 Execution-pipeline legs"):
                                     self.text.index("## 6. Drift-check invocation")].split())
        for phrase in ("**Advisor (0.1.21, Story 26.3).**",
                       "`opus`, `fable` or `off`", "a missing field means `off`",
                       "The pairing rule: the advisor must rank at or above the leg's model",
                       "`<where>.<leg>: advisor '<a>' ranks below model '<m>' (the advisor "
                       "must rank at or above the leg's model)`",
                       '`"--advisor", "<value>"`', "only when that leg's advisor is not `off`",
                       "source `inherited-session`",
                       "The advisor on a subagent leg is steering, not a switch",
                       'keep `advisor = "off"` on every leg'):
            self.assertIn(phrase, section)

    # --- Story 26.5: the planning adapter's status pull-back, appended to
    # the 0.1.21 clause (no bump) with its own §4 subsection

    def test_0_1_21_status_pull_back_clause_and_section_4(self):
        header = next(line for line in self.text.splitlines()
                      if line.startswith("| **Contract version**"))
        # the 0.1.21 clause survives in the history once 0.1.22 heads it
        self.assertNotIn("**0.1.21**", header)
        self.assertLess(header.index("0.1.21 (Story 26.3)"),
                        header.index("0.1.21 (Story 26.5)"))
        clause = header[header.index("0.1.21 (Story 26.5)"):
                        header.index("0.1.22 (Story 28.2)")]
        for phrase in ("`plansync.py status --directory ROOT --id ST-NNN "
                       "--status ENUM [--note TEXT] [--caller NAME] [--dry-run]`",
                       "`external.driver` snapshot", "`plan/index.md`",
                       "status-class only (AD-5)", "`plan_dir`", "— additive"):
            self.assertIn(phrase, clause)
        section = " ".join(self.text[
            self.text.index("### Status pull-back (0.1.21, Story 26.5)"):
            self.text.index("### KB-injection directive (0.1.7)")].split())
        self.assertGreater(self.text.index("### Status pull-back (0.1.21, Story 26.5)"),
                           self.text.index("## 4. Job model and scheduler verbs"))
        for phrase in ("**Status-class only, AD-5.**",
                       "`draft`, `ready`, `in-progress`, `blocked`, `review`, "
                       "`done`, `dropped`",
                       "`external.driver` = `{key, synced_at, content_hash, "
                       "caller, status, note, previous_status}`",
                       "default `tk-studio-plan-sync`",
                       "`status '<v>' is not in the canonical enum (draft, "
                       "ready, in-progress, blocked, review, done, dropped)`",
                       "`unknown id <ID>: no canonical entity in <plan dir>`",
                       "`<ID> is a <type>, not a story — status takes a story id`",
                       "`note must be a single line`",
                       "runs the existing `sync` as-is",
                       "`plan_dir` names the plan the verb wrote",
                       "Epic 27's studio supervisor calls it"):
            self.assertIn(phrase, section)

    # --- Story 28.2: 0.1.22 states the nearest-root rule (§1 Project root)
    # and §6's optional drift-check roots keys

    def test_0_1_22_header_project_root_and_drift_check_keys(self):
        header = next(line for line in self.text.splitlines()
                      if line.startswith("| **Contract version**"))
        # the 0.1.22 clause survives in the history once a later bump heads it
        self.assertNotIn("**0.1.22**", header)
        self.assertNotIn("**0.1.21**", header)
        self.assertNotIn("0.2.0 (", header)
        self.assertLess(header.index("0.1.21 (Story 26.5)"),
                        header.index("0.1.22 (Story 28.2)"))
        clause = header[header.index("0.1.22 (Story 28.2)"):]
        for phrase in ("nearest-root rule", "`.tk-studio/config.yaml`",
                       "`TK_STUDIO_ROOT` keeps meaning the outer repository root",
                       "`config.py standup`", "`registry.py register`",
                       "`project_root`", "`studio_root`", "`nested`",
                       "`project_id`", "— additive"):
            self.assertIn(phrase, clause)
        stories = next(line for line in self.text.splitlines()
                       if line.startswith("| Story / rulings"))
        self.assertIn("Story 28.2", stories)
        start = self.text.index("### Project root (0.1.22)")
        self.assertGreater(start, self.text.index("### Driver roster (0.1.18)"))
        self.assertLess(start, self.text.index("### Auth preflight"))
        section = " ".join(self.text[start:self.text.index("### Auth preflight")].split())
        for phrase in ("**nearest** ancestor-or-self of the given folder holding "
                       "`.tk-studio/config.yaml`",
                       "resolves to itself (not yet onboarded)",
                       "**Creation verbs never walk up:**",
                       "`$TK_STUDIO_ROOT` when set, else the nearest "
                       "ancestor-or-self of the project root holding `plugins/tk-studio/`",
                       "never the plugin's own folder",
                       'lib/config.py" root [--directory DIR]`',
                       "`~/.tk-studio/projects/<project_id>/`"):
            self.assertIn(phrase, section)
        drift = " ".join(self.text[self.text.index("## 6. Drift-check invocation"):].split())
        for phrase in ("project_root?, studio_root?, nested?, project_id?",
                       "four optional roots keys (0.1.22)", "(`null` when unresolved)",
                       "[Project root](#project-root-0122)"):
            self.assertIn(phrase, drift)

    # --- Story 28.6: 0.1.23 honours the supervisor's starter lock (§4)

    def test_0_1_23_header_and_starter_lock_section(self):
        header = next(line for line in self.text.splitlines()
                      if line.startswith("| **Contract version**"))
        # 0.1.25 (Story 30.4) heads the header; the 0.1.23 clause stays
        self.assertIn("0.1.23 (Story 28.6)", header)
        self.assertNotIn("**0.1.22**", header)
        self.assertNotIn("**0.1.23**", header)
        self.assertNotIn("0.2.0 (", header)
        self.assertLess(header.index("0.1.22 (Story 28.2)"),
                        header.index("0.1.23 (Story 28.6)"))
        clause = header[header.index("0.1.23 (Story 28.6)"):]
        for phrase in ("`StarterLocked`", "`--force-starter`",
                       "`TK_STUDIO_IGNORE_STARTER_LOCK=1`", "`starter_lock`",
                       "[Starter lock](#starter-lock-0123-story-286)",
                       "— additive"):
            self.assertIn(phrase, clause)
        stories = next(line for line in self.text.splitlines()
                       if line.startswith("| Story / rulings"))
        self.assertIn("Story 28.6", stories)
        start = self.text.index("### Starter lock (0.1.23, Story 28.6)")
        self.assertGreater(start, self.text.index(
            "## 4. Job model and scheduler verbs"))
        self.assertLess(start, self.text.index("## 5. Model & effort override API"))
        section = " ".join(self.text[start:self.text.index(
            "### Status pull-back (0.1.21, Story 26.5)")].split())
        for phrase in ("`~/.tk-studio/projects/<key>/starter.lock`",
                       "`{starter, checkout, since, supervisor_pid}`",
                       "`tk-studio-supervisor queue`",
                       "**Judged after every other refusal, before anything is minted.**",
                       "is **no lock** — it never refuses",
                       "`STARTER_LOCK_STALE_S` (900 s)",
                       "`{job_id, run_id: null, accepted: false, reason}`",
                       "`{woken: false, run_id: null, reason}`",
                       "`StarterLocked: tk-studio-supervisor's queue is the only "
                       "starter on this checkout (since <since>, supervisor pid "
                       "<pid>) — submit the job to the supervisor (POST /jobs or "
                       "bun src/cli.ts submit)`",
                       "The `--force-starter` flag (on `submit` and `wake` only)",
                       "the `TK_STUDIO_IGNORE_STARTER_LOCK` variable set exactly to `1`",
                       "**`starter_lock` answer field** (optional): `\"forced\"`",
                       "`\"stale\"`", "The MCP `tk_job` surface"):
            self.assertIn(phrase, section)
        table = " ".join(self.text[self.text.index("## 4. Job model and scheduler verbs"):
                                   self.text.index("Guarantees a driver can rely on:")].split())
        self.assertIn("`{job_id, run_id, accepted: bool, reason?, starter_lock?}` (0.1.23)", table)
        self.assertIn("`{woken: bool, run_id?, reason?, starter_lock?}` (0.1.23)", table)

    # --- Story 29.4: 0.1.24 names the studio web as a consumer and the
    # supervisor surfaces it reads (§1), never plugin surfaces (AD-2). The
    # slices hold whether Story 28.6's 0.1.23 clause is present or absent.

    def test_0_1_24_names_the_web_and_the_supervisor_surfaces(self):
        header = next(line for line in self.text.splitlines()
                      if line.startswith("| **Contract version**"))
        # 0.1.27 (Story 32.1) heads the header now; the 0.1.24 clause stays
        self.assertIn("**0.1.27**", header)
        for older in ("**0.1.22**", "**0.1.23**", "**0.1.24**"):
            self.assertNotIn(older, header)
        self.assertNotIn("0.2.0 (", header)
        self.assertLess(header.index("0.1.22 (Story 28.2)"),
                        header.index("0.1.24 (Story 29.4)"))
        clause = header[header.index("0.1.24 (Story 29.4)"):]
        for phrase in ("the studio web", "a consumer, not a driver",
                       "[Supervisor surfaces the web consumes]"
                       "(#supervisor-surfaces-the-web-consumes-0124)",
                       "`POST /auth/account`", "`POST /auth/signin`",
                       "`GET /agents`", "`GET /office`", "`GET /office/events`",
                       "never plugin surfaces",
                       "nothing in the plugin's own surfaces changes",
                       "— additive"):
            self.assertIn(phrase, clause)
        stories = next(line for line in self.text.splitlines()
                       if line.startswith("| Story / rulings"))
        self.assertIn("Story 29.4", stories)
        audience = next(line for line in self.text.splitlines()
                        if line.startswith("| Audience"))
        self.assertIn("studio web", audience)
        # the web is a consumer, never a driver: the roster keeps its three
        roster = self._section("### Driver roster (0.1.18)",
                               "### Supervisor surfaces the web consumes (0.1.24)")
        drivers = [line.split("|")[1].strip() for line in roster.splitlines()
                   if line.startswith("| ") and "---" not in line]
        self.assertEqual(drivers, ["Driver", "the studio supervisor", "Hermes",
                                   "direct invocation"])
        flat_roster = " ".join(roster.split())
        for phrase in ("the studio web", "a consumer, not a driver"):
            self.assertIn(phrase, flat_roster)
        title = "### Supervisor surfaces the web consumes (0.1.24)"
        start = self.text.index(title)
        self.assertGreater(start, self.text.index("### Driver roster (0.1.18)"))
        self.assertLess(start, self.text.index("## 2. Skill invocation surface"))
        end = self.text.index("\n### ", start + len(title))
        section = " ".join(self.text[start:end].split())
        for phrase in ("These are supervisor surfaces (AD-2)",
                       "the plugin publishes their description but neither "
                       "implements nor serves them",
                       "never plugin surfaces",
                       "`POST /auth/account`", "`POST /auth/signin`",
                       "`GET /agents`", "`GET /office`", "`GET /office/events`",
                       "`office.agent`", "`office.progress`", "`office.run`",
                       "`offline`, `idle`, `thinking`, `reading`, `typing`, "
                       "`running`, `waiting-for-human`, `blocked`",
                       "`event:snapshot`", "`<boot>-<seq>`", "`Last-Event-ID`",
                       "every 10 s", '`overlay` `"done"`, `"failed"` or `null`',
                       "`stories-validated`", "`status: done`",
                       "the journal wins", "apps/supervisor/README.md",
                       # office.run fires on appearing, changing and leaving
                       "`office.run` fires when a run appears in the live "
                       "set (`from` `null`), changes state, or leaves the "
                       "live set (`state` its queue state, `null` when the "
                       "run is gone; `from` its last live state)",
                       "`null` for the agent's first appearance",
                       "`401 SignInRefused`", "`400 AccountInvalid`",
                       "`400 MalformedJson`",
                       "`500 AccountRecordInvalid`",
                       "the next visit creates the account again"):
            self.assertIn(phrase, section)
        # the projection's internals stay the supervisor's (never contract)
        for name in ("OFFICE_MAP", "OFFICE_RANK", "mapRoles", "selectRun",
                     "engineRunDir", "LIVE_RUN_STATES", "officeStates",
                     "officeCachedPaths", "specsDone", "launchedSinceMove"):
            self.assertNotIn(name, self.text)
        # §7 row 6 names the web among the UI-carrying consumers and still
        # says the studio (the plugin) grows no UI
        dossier = self.text[self.text.index("integration dossier coverage"):
                            self.text.index("## 8. Conformance")]
        row6 = next(line for line in dossier.splitlines()
                    if line.startswith("| 6 |"))
        for phrase in ("studio supervisor", "status page", "studio web",
                       "Hermes", "front door", "grows no UI"):
            self.assertIn(phrase, row6)

    # --- Story 30.4: 0.1.25 extends the office projection additively
    # (`reason` on agent rows and `office.agent`, `last_run` on the snapshot
    # and on a terminal run's leaving `office.run`); supervisor surfaces,
    # never plugin surfaces (AD-2). 30.5 adds `GET /board` to this entry.

    def test_0_1_25_extends_the_office_projection_additively(self):
        header = next(line for line in self.text.splitlines()
                      if line.startswith("| **Contract version**"))
        self.assertIn("**0.1.27**", header)
        self.assertNotIn("**0.1.24**", header)
        self.assertNotIn("0.2.0 (", header)
        self.assertLess(header.index("0.1.24 (Story 29.4)"),
                        header.index("0.1.25 (Story 30.4)"))
        clause = " ".join(header[header.index("0.1.25 (Story 30.4)"):].split())
        for phrase in ("`reason`", "`office.agent`", "`last_run`",
                       "`{run_id, state, pr, ended_at}`", "`office.run`",
                       "`GET /office`", "Story 30.5 adds `GET /board`",
                       "never plugin surfaces",
                       "nothing in the plugin's own surfaces changes",
                       "— additive"):
            self.assertIn(phrase, clause)
        stories = next(line for line in self.text.splitlines()
                       if line.startswith("| Story / rulings"))
        self.assertIn("Story 30.4", stories)
        # the section keeps its 0.1.24 heading and the pinned office.run
        # sentence, and gains the 0.1.25 note
        title = "### Supervisor surfaces the web consumes (0.1.24)"
        start = self.text.index(title)
        end = self.text.index("\n### ", start + len(title))
        section = " ".join(self.text[start:end].split())
        self.assertIn("`office.run` fires when a run appears in the live "
                      "set (`from` `null`), changes state, or leaves the "
                      "live set (`state` its queue state, `null` when the "
                      "run is gone; `from` its last live state)", section)
        note = section[section.index("**0.1.25 (Story 30.4, additive).**"):]
        for phrase in ("`reason`", "`waiting-for-human`", "`blocked`",
                       "a change of `reason` alone fires `office.agent`",
                       "`last_run`, keyed by project",
                       "`{run_id, state, pr, ended_at}`", "`pr` `null`",
                       "has no entry", "leaving the live set terminal",
                       "Existing fields, kinds, ids and the rules below "
                       "are unchanged"):
            self.assertIn(phrase, note)
        self.assertLess(section.index("**0.1.25 (Story 30.4, additive).**"),
                        section.index("**The rules a consumer may rely on**"))

    # --- Story 30.5: `GET /board` joins 30.4's 0.1.25 entry (no second
    # bump); a supervisor surface, never a plugin surface (AD-2).

    def test_0_1_25_names_the_board(self):
        header = next(line for line in self.text.splitlines()
                      if line.startswith("| **Contract version**"))
        # 0.1.27 (Story 32.1) heads the header now; the 0.1.25 clauses stay
        self.assertIn("**0.1.27**", header)
        self.assertNotIn("**0.1.25**", header)
        self.assertLess(header.index("0.1.25 (Story 30.4)"),
                        header.index("0.1.25 (Story 30.5)"))
        clause = " ".join(header[header.index("0.1.25 (Story 30.5)"):].split())
        for phrase in ("`GET /board?project=<id>`",
                       "canonical statuses", "latest run",
                       "deferred-work findings", "`job-run` spend",
                       "Needs-you / Working / Done",
                       "no second version bump",
                       "never a plugin surface", "— additive"):
            self.assertIn(phrase, clause)
        stories = next(line for line in self.text.splitlines()
                       if line.startswith("| Story / rulings"))
        self.assertIn("Story 30.5", stories)
        title = "### Supervisor surfaces the web consumes (0.1.24)"
        start = self.text.index(title)
        end = self.text.index("\n### ", start + len(title))
        section = " ".join(self.text[start:end].split())
        row = next(line for line in self.text[start:end].splitlines()
                   if line.startswith("| the board (Story 30.5, 0.1.25) |"))
        for phrase in ("`GET /board?project=<id>`",
                       "`{ok:true, project, built_at, plan, epics, triage}`",
                       "`{run_id, state, pr, host_verify, ended_at}`",
                       "`spend_usd` against `band_usd`",
                       "`400 ProjectRequired`", "`404 UnknownProject`",
                       "a read that writes nothing"):
            self.assertIn(phrase, row)
        note = section[section.index("Story 30.5 adds `GET /board?project=<id>` "
                                     "to this same 0.1.25 entry (no second "
                                     "bump)"):]
        for phrase in ("`needs_you`, `working` and `done`",
                       "`{run_id, state, story_key, pr, ruling}`",
                       "exactly one of Needs-you and Working",
                       "the supervisor host's local day",
                       "a terminal run ended that day with a red host leg is in Needs-you instead",
                       "`plan.reason`",
                       "`.tk-studio/budget-bands.yaml`"):
            self.assertIn(phrase, note)
        self.assertLess(section.index("**0.1.25 (Story 30.4, additive).**"),
                        section.index("Story 30.5 adds `GET /board?project=<id>`"))
        self.assertLess(section.index("Story 30.5 adds `GET /board?project=<id>`"),
                        section.index("**The rules a consumer may rely on**"))

    # --- Story 30.6: the web is the home (`GET /`), the read-only page moves
    # to `GET /status` (content-negotiated), and the office snapshot carries
    # `supervisor` and `ledger`; joins the same 0.1.25 entry (no bump).

    def test_0_1_25_names_the_status_page(self):
        header = next(line for line in self.text.splitlines()
                      if line.startswith("| **Contract version**"))
        # 0.1.27 (Story 32.1) heads the header now; the 0.1.25 clauses stay
        self.assertIn("**0.1.27**", header)
        self.assertNotIn("**0.1.25**", header)
        self.assertLess(header.index("0.1.25 (Story 30.5)"),
                        header.index("0.1.25 (Story 30.6)"))
        clause = " ".join(header[header.index("0.1.25 (Story 30.6)"):].split())
        for phrase in ("a signed-in `GET /` answers the built web's `index.html`, "
                       "falling back to the read-only page when the web is not built",
                       "`GET /status`",
                       "`Accept: text/html` the page",
                       "the unchanged `/status` JSON",
                       "`supervisor` `{version, counts}`", "`ledger`",
                       "never on a delta", "no second version bump",
                       "never plugin surfaces", "— additive"):
            self.assertIn(phrase, clause)
        stories = next(line for line in self.text.splitlines()
                       if line.startswith("| Story / rulings"))
        self.assertIn("Story 30.6", stories)
        title = "### Supervisor surfaces the web consumes (0.1.24)"
        start = self.text.index(title)
        end = self.text.index("\n### ", start + len(title))
        section = " ".join(self.text[start:end].split())
        # the board row (30.5) stays; the read-only page's row names its address
        self.assertIn("| the board (Story 30.5, 0.1.25) | `GET /board?project=<id>` |",
                      self.text[start:end])
        row = next(line for line in self.text[start:end].splitlines()
                   if line.startswith("| the home and the read-only page "
                                      "(Story 30.6, 0.1.25) |"))
        for phrase in ("`GET /`, `GET /status`", "`index.html`",
                       "never a `503`", "the sign-in page",
                       "`{ok, counts, live, locks}` unchanged",
                       "`vary: Accept`", "returning to `/status`"):
            self.assertIn(phrase, row)
        note = section[section.index("Story 30.6 adds to this same 0.1.25 "
                                     "entry (no second bump)"):]
        for phrase in ("`supervisor` `{version, counts}`",
                       "as `GET /status` counts them", "`ledger`",
                       "`{path, lines}`", "each line redacted",
                       "`{path, note}`", "never a delta",
                       "The web is the home at `GET /`",
                       "moves to `GET /status`"):
            self.assertIn(phrase, note)
        self.assertLess(section.index("Story 30.5 adds `GET /board?project=<id>`"),
                        section.index("Story 30.6 adds to this same 0.1.25 entry"))
        self.assertLess(section.index("Story 30.6 adds to this same 0.1.25 entry"),
                        section.index("**The rules a consumer may rely on**"))

    # --- Story 31.2: 0.1.26 opens Epic 31's entry — the planning adapter's
    # `setup` verb, onboard's optional `tracking` step, and the Jira binding
    # on the `TK_ATLASSIAN_*` gateway names with the legacy fallback.

    def test_0_1_26_opens_epic_31_with_the_setup_verb(self):
        header = next(line for line in self.text.splitlines()
                      if line.startswith("| **Contract version**"))
        self.assertIn("**0.1.27**", header)
        self.assertNotIn("**0.1.25**", header)
        self.assertNotIn("0.2.0 (", header)
        self.assertLess(header.index("0.1.25 (Story 30.6)"),
                        header.index("0.1.26 (Story 31.2)"))
        clause = " ".join(header[header.index("0.1.26 (Story 31.2)"):].split())
        for phrase in ("opens Epic 31's entry", "`setup` verb",
                       "`plansync.py setup --directory ROOT [--dry-run] "
                       "[--owner-account-id ID | --owner-email EMAIL]`",
                       "`Blocked - Awaiting User`", "`Block Resolved`",
                       "\"Needs you\"", "`planning.jira`",
                       "`planning.confluence`", "`owner_steps[]`",
                       "`found[]`, `created[]` and `written[]`",
                       "`would_create[]`, dry run only",
                       "`tracking`", "`TK_ATLASSIAN_*`", "`api.atlassian.com`",
                       "`/rest/api/2` kept", "legacy fallback", "— additive"):
            self.assertIn(phrase, clause)
        stories = next(line for line in self.text.splitlines()
                       if line.startswith("| Story / rulings"))
        self.assertIn("Story 31.2", stories)
        onboard = next(line for line in self.text.splitlines()
                       if line.startswith("| `tk-studio-onboard` |"))
        for phrase in ("`tracking?` (0.1.26", "`lib/plansync.py setup`",
                       "`planning.jira` and `planning.confluence`",
                       "`partial` with the owner's numbered steps verbatim",
                       "an unregistered project",
                       "`TK_ATLASSIAN_AGENT_CONFLUENCE_TOKEN`",
                       "`TK_ATLASSIAN_CLOUD_ID`", "before any Atlassian call"):
            self.assertIn(phrase, onboard)
        plan_sync = next(line for line in self.text.splitlines()
                         if line.startswith("| `tk-studio-plan-sync` |"))
        for phrase in ("`lib/plansync.py sync|normalize|setup|publish`",
                       "`api.atlassian.com` gateway",
                       "never the site URL",
                       "the legacy `JIRA_EMAIL`/`JIRA_API_TOKEN`",
                       "network approval step", "the missing scope",
                       "never `complete`",
                       "a dry run that would create anything ends "
                       "`partial` and names those items in "
                       "`would_create[]`"):
            self.assertIn(phrase, plan_sync)

    # --- Story 31.3: the same 0.1.26 entry names the `publish` verb (no
    # bump), the plan-sync row's core and its refusals.

    def test_0_1_26_names_publish(self):
        header = next(line for line in self.text.splitlines()
                      if line.startswith("| **Contract version**"))
        self.assertIn("**0.1.27**", header)
        self.assertLess(header.index("0.1.26 (Story 31.2)"),
                        header.index("0.1.26 (Story 31.3)"))
        clause = " ".join(header[header.index("0.1.26 (Story 31.3)"):].split())
        for phrase in ("`publish` verb",
                       "`plansync.py publish --directory ROOT [--dry-run] "
                       "[--source CATEGORY=PATH ...] [--attachment-max-bytes N]`",
                       "never the records folder", "stable title",
                       "provenance footer", "content hash",
                       "unchanged page is skipped", "refused by name",
                       "`would_publish[]`", "`bytes_uploaded`",
                       "`.tk-studio/confluence-pages.json`",
                       "`Design pages:` line", "(AD-5)", "— additive"):
            self.assertIn(phrase, clause)
        stories = next(line for line in self.text.splitlines()
                       if line.startswith("| Story / rulings"))
        self.assertIn("Story 31.3", stories)
        plan_sync = next(line for line in self.text.splitlines()
                         if line.startswith("| `tk-studio-plan-sync` |"))
        for phrase in ("`publish?` (0.1.26, Story 31.3",
                       "`attachment_max_bytes?`",
                       "`--attachment-max-bytes`",
                       "`lib/plansync.py sync|normalize|setup|publish`",
                       "`TK_ATLASSIAN_AGENT_CONFLUENCE_TOKEN`",
                       "run `plansync.py setup` first",
                       "two sources with one title",
                       "no Atlassian call", "`skipped[]`", "`refused[]`",
                       "its page still publishes"):
            self.assertIn(phrase, plan_sync)

    # --- Story 31.4: the same 0.1.26 entry names the `sync-back` verb (no
    # bump), the plan-sync row, §4's `{project_root}` note and §6's
    # five-plane check with the tracking plane.

    def test_0_1_26_names_sync_back(self):
        header = next(line for line in self.text.splitlines()
                      if line.startswith("| **Contract version**"))
        self.assertIn("**0.1.27**", header)
        self.assertLess(header.index("0.1.26 (Story 31.3)"),
                        header.index("0.1.26 (Story 31.4)"))
        clause = " ".join(header[header.index("0.1.26 (Story 31.4)"):].split())
        for phrase in ("`sync-back` verb",
                       "`plansync.py sync-back --directory ROOT [--dry-run]`",
                       "`Blocked - Awaiting User` and `Block Resolved` are "
                       "canonical `blocked`", "`external.jira`", "(AD-5)",
                       "`_bmad-output/tracking/<KEY>/comments.jsonl`",
                       "`{issue, id, author: owner | agent, body, mentions[], "
                       "created, updated, source: jira}`",
                       "a comment seen twice is written once",
                       "`_bmad-output/tracking/<KEY>/attachments.jsonl`",
                       "`kb/confluence/<slug>.md`", "`overwritten[]`",
                       "`content_hash: sha256:<hex>`",
                       "one paged JQL search per tick", "never a GET per issue",
                       "`Retry-After`", "`RateLimit-Reason`",
                       "`counts`, `newest_comment`",
                       "`sync_back?`", "`atlassian-sync-back`",
                       "stamping `updated`", "raises at once",
                       "regenerates `plan/index.md`, local-only",
                       "`{project_root}`", "five-plane", "`tracking` plane",
                       "nothing local is promoted back", "— additive",
                       "a preflight answered with another, non-auth "
                       "status, run case `error`",
                       "an unrecorded `planning.confluence.space_id`, the "
                       "mirror skipped",
                       "only an issue whose `comment.total` exceeds the "
                       "comments the search returned pages "
                       "`GET /rest/api/2/issue/{key}/comment` (overflow "
                       "only)"):
            self.assertIn(phrase, clause)
        stories = next(line for line in self.text.splitlines()
                       if line.startswith("| Story / rulings"))
        self.assertIn("Story 31.4", stories)
        plan_sync = next(line for line in self.text.splitlines()
                         if line.startswith("| `tk-studio-plan-sync` |"))
        for phrase in ("`sync_back?` (0.1.26, Story 31.4",
                       "`lib/plansync.py sync-back` (0.1.26, Story 31.4)",
                       "`sync-back` (0.1.26, Story 31.4) ends `blocked`",
                       "no Atlassian call", "the cursor unchanged",
                       "`RateLimit-Reason` named", "never runs promote",
                       "entity `status` (stamping `updated`)",
                       "`plan/index.md` (regenerated local-only",
                       "no recorded owner accountId also leaves the "
                       "cursor unchanged",
                       "a preflight answered with another, non-auth "
                       "status: run case `error`",
                       "an unrecorded `planning.confluence.space_id` (the "
                       "mirror skipped)",
                       "only an issue whose `comment.total` exceeds the "
                       "comments the search returned pages "
                       "`GET /rest/api/2/issue/{key}/comment` (overflow "
                       "only)"):
            self.assertIn(phrase, plan_sync)
        section_4 = self.text[self.text.index("## 4. Job model"):
                              self.text.index("## 5. Model")]
        flat = " ".join(section_4.split())
        for phrase in ("`{project_root}` core argument",
                       "replaced by the submitting project's root",
                       "no other templating", "`newest_comment`"):
            self.assertIn(phrase, flat)
        section_6 = self.text[self.text.index("## 6. Drift-check"):]
        flat = " ".join(section_6.split())
        for phrase in ("five-plane", '"tracking"', "`not-bound`",
                       "`never-run`", "`stale`", "`token-missing`",
                       "`unreachable`", "`deactivated`", "`auth`",
                       "never a network call", "owner's sign-in",
                       "never \"no changes\"",
                       "`{at, status, case, counts, newest_comment, "
                       "reason}`", "`rate-limited` (an exhausted `429`)",
                       "`error` (a non-network request error",
                       "as `ok` or `stale` by age and status",
                       "never as a ninth plane case",
                       "so does an `unreachable` run case not on preflight",
                       "never \"has not ticked\""):
            self.assertIn(phrase, flat)

    # --- Story 31.5: the same 0.1.26 entry names the `tk-studio-track`
    # surface (its §2 row), `GET /inbox` (its §1 row), the inbox file and
    # the office's `blocked_issue` (no bump).

    def test_0_1_26_names_track_and_the_inbox(self):
        header = next(line for line in self.text.splitlines()
                      if line.startswith("| **Contract version**"))
        self.assertIn("**0.1.27**", header)
        self.assertLess(header.index("0.1.26 (Story 31.4)"),
                        header.index("0.1.26 (Story 31.5)"))
        clause = " ".join(header[header.index("0.1.26 (Story 31.5)"):].split())
        for phrase in ("`tk-studio-track` surface",
                       "`track.py block --directory ROOT --story <ST-NNN | "
                       "N-M-slug> --reason TEXT --resolves TEXT [--source "
                       "run|engagement] [--dry-run]`",
                       "`Blocked - Awaiting User` by the transition's target "
                       "name, never its category", "(AD-4)",
                       "`[~accountid:<owner>] Blocked: <reason>`",
                       "`Blocked by: <key>`",
                       "`planning.jira.owner_account_id`",
                       "`track-block` event", "DRIFT",
                       "`update_author: owner | agent`",
                       "`_bmad-output/tracking/inbox.json`",
                       "state: open | resolved | validating",
                       "`rate-limited`, `error` or `blocked` tick leaves it "
                       "untouched", "`GET /inbox?project=<id>`",
                       "`blocked_issue`", "(D9)", "— additive"):
            self.assertIn(phrase, clause)
        stories = next(line for line in self.text.splitlines()
                       if line.startswith("| Story / rulings"))
        self.assertIn("Story 31.5", stories)
        row = next(line for line in self.text.splitlines()
                   if line.startswith("| `tk-studio-track` "))
        for phrase in ("verb `block`", "`lib/track.py block`",
                       "`source?` (`run` \\| `engagement`",
                       "by transition name", "`lib/jirabackend.py` (AD-4)",
                       "`skipped[]`", "no Atlassian call",
                       "`planning.jira.owner_account_id`",
                       "`external.jira.key`", "ends `partial`",
                       # the review's additive clarifications
                       "already `done` or `dropped` is skipped",
                       "`ok: false` and the additive `retry: true`",
                       "already in the status before the run"):
            self.assertIn(phrase, row)
        title = "### Supervisor surfaces the web consumes (0.1.24)"
        section = self.text[self.text.index(title):]
        # the stream: `office.agent` deltas carry `blocked_issue`, and a
        # change of it alone fires one (beside 0.1.25's `reason`)
        flat = " ".join(section[:section.index(
            "**The rules a consumer may rely on**")].split())
        note = flat[flat.index("**0.1.26 (Story 31.5, additive).**"):]
        for phrase in ("every `office.agent` delta carry `blocked_issue`",
                       "`{issue, state}`", "`null` otherwise",
                       "a change of `blocked_issue` alone fires "
                       "`office.agent`", "never moved by a comment or a "
                       "message"):
            self.assertIn(phrase, note)
        inbox = next(line for line in section.splitlines()
                     if line.startswith("| the inbox (Story 31.5, 0.1.26) |"))
        for phrase in ("`GET /inbox?project=<id>`",
                       "`{ok:true, project, generated_at, items:[…]}`",
                       "`items: []` with `generated_at: null`, never a `404`",
                       "`400 ProjectRequired`", "`404 UnknownProject`",
                       "the bearer or the cookie", "`blocked_issue`",
                       "never a comment or message event", "additive"):
            self.assertIn(phrase, inbox)

    # --- Story 31.6: the same 0.1.26 entry names the `reply` verb, the
    # issue read, `POST /inbox/{key}/reply` and the CSRF header (no bump).

    def test_0_1_26_names_reply_and_the_issue_read(self):
        header = next(line for line in self.text.splitlines()
                      if line.startswith("| **Contract version**"))
        self.assertIn("**0.1.27**", header)
        self.assertLess(header.index("0.1.26 (Story 31.5)"),
                        header.index("0.1.26 (Story 31.6)"))
        clause = " ".join(header[header.index("0.1.26 (Story 31.6)"):].split())
        for phrase in ("`reply` verb",
                       "`track.py reply --directory ROOT --issue <KEY> "
                       "(--body-file PATH | --done) [--dry-run]`",
                       "`Done.`", "never the command line",
                       "`TK_STUDIO_ATLASSIAN_OWNER_EMAIL`",
                       "`TK_STUDIO_ATLASSIAN_OWNER_TOKEN`", "host-only",
                       "`TK_ATLASSIAN_CLOUD_ID` gateway", "`/rest/api/2`",
                       "DRIFT", "`Block Resolved`", "(AD-4)", "`skipped[]`",
                       "the agent's token never stands in",
                       "nothing moved", "`retry: true`", "(D9)",
                       "`GET /inbox?project=<id>&issue=<KEY>`",
                       "`POST /inbox/{key}/reply`", "`X-CSRF-Token`",
                       "— additive"):
            self.assertIn(phrase, clause)
        stories = next(line for line in self.text.splitlines()
                       if line.startswith("| Story / rulings"))
        self.assertIn("Story 31.6", stories)
        row = next(line for line in self.text.splitlines()
                   if line.startswith("| `tk-studio-track` "))
        for phrase in ("`reply`", "`lib/track.py reply`", "`--body-file`",
                       "`done?`", "`TK_STUDIO_ATLASSIAN_OWNER_TOKEN`",
                       "`Block Resolved`", "comment_id, transitioned",
                       "not authored by the owner"):
            self.assertIn(phrase, row)
        title = "### Supervisor surfaces the web consumes (0.1.24)"
        section = self.text[self.text.index(title):]
        inbox = next(line for line in section.splitlines()
                     if line.startswith("| the inbox (Story 31.5, 0.1.26) |"))
        for phrase in ("`GET /inbox?project=<id>&issue=<KEY>`",
                       "`{key, entity, title, status, run, cost_usd, "
                       "comments[]}`", "`400 BadIssue`",
                       "`404 UnknownIssue`", "`500 IssueReadFailed`",
                       "last `_bmad-output/tracking/"
                       "<KEY>/comments.jsonl` line per `id`",
                       "`X-CSRF-Token` response header"):
            self.assertIn(phrase, inbox)
        reply = next(line for line in section.splitlines()
                     if line.startswith("| the owner's reply (Story 31.6, "
                                        "0.1.26) |"))
        for phrase in ("`POST /inbox/{key}/reply`",
                       "`{project, body?, done?: true}`", "32 KiB",
                       "`400 SchemaError`", "`400 MalformedJson`",
                       "a malformed key `400 BadIssue`",
                       "`status` is the verb's §3 status",
                       "never the issue's Jira status", "`403 CsrfRefused`",
                       "`409 OwnerSeatMissing {missing}`", "no spawn",
                       "--body-file <tmp>`", "never reach the sandbox",
                       "`409 ReplyRefused {reason, commented}`",
                       "`503 ReplyRetry {reason, commented}`", "`500 ReplyFailed`",
                       "`404 UnknownProject`", "no queue event",
                       "next sync-back", "additive"):
            self.assertIn(phrase, reply)

    # --- Story 31.7: the same 0.1.26 entry names the `validate` verb, the
    # shipped `validate-resolution` job and the `validate` no-env drive.

    def test_0_1_26_names_validate_and_its_job(self):
        header = next(line for line in self.text.splitlines()
                      if line.startswith("| **Contract version**"))
        self.assertIn("**0.1.27**", header)
        self.assertLess(header.index("0.1.26 (Story 31.6)"),
                        header.index("0.1.26 (Story 31.7)"))
        clause = " ".join(header[header.index("0.1.26 (Story 31.7)"):].split())
        for phrase in ("`validate` verb",
                       "`track.py validate --directory ROOT --issue <KEY> "
                       "(--check | --pass --to \"To Do\"|\"In Progress\" "
                       "[--ruling-file PATH --spec PATH] | --fail "
                       "--follow-up-file PATH) [--dry-run]`",
                       "the agent seat only", "changelog", "(AD-4)",
                       "`owner_resolved`", "`planning.jira.owner_account_id`",
                       "an older owner transition never validates a later "
                       "one", "absent or empty accountId never matches",
                       "`validating`", "`</intent-contract>`",
                       "`</frozen-after-approval>`", "never `status:`",
                       "`_bmad-output/tracking/<KEY>/validation.jsonl`",
                       "no Atlassian call made", "`retry: true`",
                       "`validate-resolution`", "planner leg", "DRIFT",
                       "EP-32", "(D9)", "— additive"):
            self.assertIn(phrase, clause)
        stories = next(line for line in self.text.splitlines()
                       if line.startswith("| Story / rulings"))
        self.assertIn("Story 31.7", stories)
        row = next(line for line in self.text.splitlines()
                   if line.startswith("| `tk-studio-track` "))
        for phrase in ("`validate`", "`lib/track.py validate`",
                       "`--ruling-file`", "`--follow-up-file`",
                       "`owner_resolved`", "`validation.jsonl`",
                       "a live status other than `Block Resolved`"):
            self.assertIn(phrase, row)
        flat = " ".join(self.text.split())
        for phrase in ("The shipped `validate-resolution` job (0.1.26, "
                       "Story 31.7)", "`payload.verb: validate`",
                       "`tier: host`", "planner leg's model and effort",
                       "no `model`"):
            self.assertIn(phrase, flat)
        manifest = json.loads((PLUGIN_ROOT / "contracts" / "conformance"
                               / "manifest.json").read_text("utf-8"))
        drives = manifest["surfaces"]["tk-studio-track"]["drives"]
        validate = [d for d in drives if d["argv"][1] == "validate"]
        self.assertEqual(len(validate), 1)
        self.assertEqual((validate[0]["status"], validate[0]["marker"],
                          validate[0]["expect"]),
                         ("blocked", "no Atlassian call made",
                          "status-block"))

    # --- Story 32.1: 0.1.27 opens Epic 32's entry — the engagement record,
    # its four supervisor routes and the one engagement state table (§1).

    def test_0_1_27_opens_the_engagement_entry(self):
        header = next(line for line in self.text.splitlines()
                      if line.startswith("| **Contract version**"))
        self.assertIn("**0.1.27**", header)
        self.assertNotIn("**0.1.26**", header)
        self.assertNotIn("**0.1.28**", header)
        for older in ("0.1.26 (Story 31.2)", "0.1.26 (Story 31.7)"):
            self.assertLess(header.index(older),
                            header.index("0.1.27 (Story 32.1)"))
        clause = " ".join(header[header.index("0.1.27 (Story 32.1)"):].split())
        for phrase in ("`POST /engagements`", "`GET /engagements?project=",
                       "`GET /engagements/{id}`",
                       "`POST /engagements/{id}/input`",
                       "`office.engagement`", "— additive"):
            self.assertIn(phrase, clause)
        stories = next(line for line in self.text.splitlines()
                       if line.startswith("| Story / rulings"))
        self.assertIn("Story 32.1", stories)
        rows = [line for line in self.text.splitlines()
                if line.startswith("| the engagement")]
        routes = " ".join(rows)
        for phrase in ("| `POST /engagements` |",
                       "| `GET /engagements?project=<id>` |",
                       "| `GET /engagements/{id}` |",
                       "| `POST /engagements/{id}/input` |",
                       "`{ok:true, project, engagement, chat}`",
                       "`{ok:true, project, engagements:[…], problems:[…]}`"):
            self.assertIn(phrase, routes)
        self.assertIn("### The engagement state table (0.1.27, Story 32.1)",
                      self.text)
        flat = " ".join(self.text.split())
        self.assertIn("**0.1.27 (Story 32.1, additive).**", flat)
        self.assertIn("keyed by project plus id", flat)

    # --- Story 32.2: the same 0.1.27 entry adds the engagement's chat (two
    # supervisor routes), the `tk-studio-engage` surface and the shipped
    # `engagement-chat` job — additive, never a 0.1.28.

    def test_0_1_27_story_32_2_adds_the_chat_and_the_engage_surface(self):
        header = next(line for line in self.text.splitlines()
                      if line.startswith("| **Contract version**"))
        self.assertIn("**0.1.27**", header)
        self.assertNotIn("**0.1.28**", header)
        self.assertNotIn("**0.1.28**", self.text)
        self.assertLess(header.index("0.1.27 (Story 32.1)"),
                        header.index("0.1.27 (Story 32.2) adds to this same "
                                     "entry"))
        clause = " ".join(header[header.index("0.1.27 (Story 32.2)"):]
                          .split())
        for phrase in ("`POST /chat/{engagement}`",
                       "`GET /chat/{engagement}?since=<seq>`",
                       "`tk-studio-engage`", "`engagement-chat`",
                       "`chat-queued`", "`spend.planning_usd`",
                       "JSON text", "— additive) |"):
            self.assertIn(phrase, clause)
        stories = next(line for line in self.text.splitlines()
                       if line.startswith("| Story / rulings"))
        self.assertIn("Story 32.2", stories)
        chat = " ".join(line for line in self.text.splitlines()
                        if line.startswith("| the engagement's chat "
                                           "(Story 32.2, 0.1.27)"))
        for phrase in ("| `POST /chat/{engagement}` |",
                       "| `GET /chat/{engagement}?since=<seq>` |",
                       "`200 {ok, engagement, seq, run_id}`",
                       "`409 EngagementClosed", "`403 CsrfRefused`",
                       "never refused, never adopted",
                       "`event: chat`", "`: heartbeat`",
                       "`Allow: GET, POST`", "`{verb, payload, label}`",
                       "`{engagement, project, project_root, seq}`",
                       "`500 ChatQueueFailed`", "`500 ChatJobUnresolved`"):
            self.assertIn(phrase, chat)
        row = next(line for line in self.text.splitlines()
                   if line.startswith("| `tk-studio-engage` "))
        for phrase in ("(0.1.27, Story 32.2)", "verb `reply`",
                       "`lib/engage.py reply`", "`ProposalInvalid`",
                       "`EngagementRecordUnreadable`", "`EngagementClosed`",
                       "the planner moves no state"):
            self.assertIn(phrase, row)
        flat = " ".join(self.text.split())
        for phrase in ("The shipped `engagement-chat` job (0.1.27, Story "
                       "32.2)", "`payload.verb: reply`", "`tier: host`",
                       "planner leg's model and effort", "`max_turns` 80",
                       "no `model`", "project_root, seq}` (`project_root` "
                       "the served registry root"):
            self.assertIn(phrase, flat)
        manifest = json.loads((PLUGIN_ROOT / "contracts" / "conformance"
                               / "manifest.json").read_text("utf-8"))
        drives = manifest["surfaces"]["tk-studio-engage"]["drives"]
        self.assertEqual([(d["argv"][:2], d["expect"], d["status"],
                           d["marker"]) for d in drives],
                         [(["lib/engage.py", "reply"], "status-block",
                           "blocked", "UnknownEngagement")])

    # --- Story 32.3: the same 0.1.27 entry adds the clarifying questions —
    # `engage.py questions`, `track.py block --engagement` and `close`, the
    # inbox item's `engagement?`, the planner desk's "!" and the `answer`
    # rows' source `supervisor` — additive, never a 0.1.28.

    def test_0_1_27_story_32_3_adds_the_questions(self):
        header = next(line for line in self.text.splitlines()
                      if line.startswith("| **Contract version**"))
        self.assertIn("**0.1.27**", header)
        self.assertNotIn("**0.1.28**", self.text)
        self.assertLess(header.index("0.1.27 (Story 32.2) adds to this same "
                                     "entry"),
                        header.index("0.1.27 (Story 32.3) adds to this same "
                                     "entry"))
        clause = " ".join(header[header.index("0.1.27 (Story 32.3)"):]
                          .split())
        for phrase in ("`engage.py questions --directory <project_root> "
                       "--engagement ENG-NNN --run-id RUN --questions-file "
                       "PATH [--dry-run]`", "`TooManyQuestions`",
                       "`QuestionInvalid`", "source `planner`",
                       "`engagement-questions-skipped",
                       "`track.py block --directory ROOT --engagement "
                       "ENG-NNN [--dry-run]`", "`ENG-NNN: questions`",
                       "`Task`", "`tk-studio-engagement`",
                       "`track.py close --directory ROOT --engagement "
                       "ENG-NNN [--dry-run]`", "source `supervisor`",
                       "`engagement?`", "`planner` agent",
                       "nothing moves on a timer", "— additive) |",
                       "no further call until a later `questions` or "
                       "`answer` line, or an owner comment that applies "
                       "nothing (`engagement-answers` with `ids: []`)"):
            self.assertIn(phrase, clause)
        stories = next(line for line in self.text.splitlines()
                       if line.startswith("| Story / rulings"))
        self.assertIn("Story 32.3", stories)
        engage = next(line for line in self.text.splitlines()
                      if line.startswith("| `tk-studio-engage` "))
        for phrase in ("`questions`, 0.1.27, Story 32.3",
                       "`lib/engage.py questions`", "`--questions-file`",
                       "`TooManyQuestions`", "`NotIntake`",
                       "`QuestionInvalid` (naming the index)"):
            self.assertIn(phrase, engage)
        track = next(line for line in self.text.splitlines()
                     if line.startswith("| `tk-studio-track` "))
        for phrase in ("`block` with `engagement`", "`close`, 0.1.27, Story "
                       "32.3", "`lib/track.py close`", "`ENG-NNN: questions`",
                       "`EngagementNotFound`", "`NoOpenQuestions`",
                       "`IssueCreateRefused`", "`NoIssue`",
                       "`NoTransition` `blocked`",
                       "`Block Resolved`, then `Done`"):
            self.assertIn(phrase, track)
        inbox = next(line for line in self.text.splitlines()
                     if line.startswith("| the inbox (Story 31.5, 0.1.26) |"))
        for phrase in ("`{issue, entity?, engagement?, title?,",
                       "the project's `planner` agent takes it from the "
                       "first `open` item carrying `engagement`"):
            self.assertIn(phrase, inbox)
        answers = [line for line in self.text.splitlines()
                   if line.startswith("| `awaiting-answers` | `answer` |")]
        self.assertEqual(len(answers), 2)
        for line in answers:
            self.assertIn("bearer \\| cookie \\| supervisor", line)

    # --- Story 32.4: the same 0.1.27 entry adds the scope of work —
    # `engage.py scope`, the page in `Engagements/ENG-NNN`, `scope_page`,
    # the sync-back's engagement scope mirror and the `revise` body —
    # additive, never a 0.1.28.

    def test_0_1_27_story_32_4_adds_the_scope_of_work(self):
        header = next(line for line in self.text.splitlines()
                      if line.startswith("| **Contract version**"))
        self.assertIn("**0.1.27**", header)
        self.assertNotIn("**0.1.28**", self.text)
        self.assertLess(header.index("0.1.27 (Story 32.3) adds to this same "
                                     "entry"),
                        header.index("0.1.27 (Story 32.4) adds to this same "
                                     "entry"))
        clause = " ".join(header[header.index("0.1.27 (Story 32.4)"):]
                          .split())
        for phrase in ("`engage.py scope --directory <project_root> "
                       "--engagement ENG-NNN [--scope-file PATH | "
                       "--revise-at AT] [--dry-run]`", "`NotScoping`",
                       "`DeliverableWithoutSignal: <title>`",
                       "`ScopeInvalid: <what>`",
                       "`AssumptionUnstated: <id>`", "`scope.lock`",
                       "`ConfluenceEnvMissing` (each absent agent-seat "
                       "variable named)",
                       "`ENG-NNN: Scope of Work`", "`Engagements/ENG-NNN`",
                       "`scope_page {id, url, version}`",
                       "not plan entities", "`kb/confluence/<slug>.md`",
                       "`engagement_pages`", "`engage.py scope --revise-at <at>`",
                       "`scope {path, text} | null`", "(D9)",
                       "— additive) |"):
            self.assertIn(phrase, clause)
        stories = next(line for line in self.text.splitlines()
                       if line.startswith("| Story / rulings"))
        self.assertIn("Story 32.4", stories)
        engage = next(line for line in self.text.splitlines()
                      if line.startswith("| `tk-studio-engage` "))
        for phrase in ("`scope`, 0.1.27, Story 32.4",
                       "`lib/engage.py scope` (Story 32.4)",
                       "Stories 32.5 to 32.8 add the verbs `quote` and "
                       "`closeout`", "`ConfluenceUnbound`",
                       "`DeliverableWithoutSignal: <title>`",
                       "`retry: true`", "taken verbatim"):
            self.assertIn(phrase, engage)
        self.assertNotIn("add the verbs `scope`", engage)
        plan_sync = next(line for line in self.text.splitlines()
                         if line.startswith("| `tk-studio-plan-sync` "))
        for phrase in ("(0.1.27, Story 32.4) an engagement's `scope.md`",
                       "`engagement_pages`", "`scopes_replaced`"):
            self.assertIn(phrase, plan_sync)
        read = next(line for line in self.text.splitlines()
                    if line.startswith("| the engagement (Story 32.1, "
                                       "0.1.27) | `GET /engagements/{id}` |"))
        self.assertIn("`scope_page {id, url, version}`", read)

    # --- Story 32.5: the same 0.1.27 entry adds the quote — the meter's
    # structured observation fields, `engage.py quote`, the record's
    # `quote` and the `budget-bands.yaml` `epics` — additive, never a 0.1.28.

    def test_0_1_27_story_32_5_adds_the_quote(self):
        header = next(line for line in self.text.splitlines()
                      if line.startswith("| **Contract version**"))
        self.assertIn("**0.1.27**", header)
        self.assertNotIn("**0.1.28**", self.text)
        self.assertLess(header.index("0.1.27 (Story 32.4) adds to this same "
                                     "entry"),
                        header.index("0.1.27 (Story 32.5) adds to this same "
                                     "entry"))
        clause = " ".join(header[header.index("0.1.27 (Story 32.5)"):]
                          .split())
        for phrase in ("`kind: meter`", "`story_key`", "`epic`", "`usd`",
                       "`legs.<leg> {usd, usage {input, output, cache_read, "
                       "cache_write}}`", "never `tokens`", "`route`",
                       "`prices_date`", "`events/taxonomy.v1.json`",
                       "`engage.py quote --directory <project_root> "
                       "--engagement ENG-NNN [--seed N] [--dry-run]`",
                       "`NotScoping`", "`NoScope`", "`PricesUnreadable`",
                       "`QuoteUnwritable`", "`unstructured`, never parsed",
                       "10,000 resamples",
                       "`cap = p95 + one story at p85`",
                       "`quote {band50, band85, band95, cap, basis, "
                       "computed_at}`", "`\"share unknown\"`",
                       "`epics.<EP-NNN>.usd_estimate`", "`band_usd`",
                       "`quote-present`",
                       # a scope replaced in scoping voids the quote,
                       # first: before scope.md is replaced
                       "voids a non-null `quote` first",
                       "merged before `scope.md` is replaced",
                       "carries no `void-quote`",
                       "a repeated `### Epic <k>` number `NoScope`",
                       # the 1..m rule, the held lock, the edges 32.6 reads
                       "not numbered 1..m in order",
                       "a held `scope.lock`",
                       "/scope.lock is held`",
                       "an unparseable `budget-bands.yaml`",
                       "an unreadable `measurements/`",
                       "`basis.notes` is a list of strings",
                       "`thin history: <n> landed stories`",
                       "`tokens unknown: thin history (no metered story)`",
                       "`tokens unknown: thin history (no usd-per-token "
                       "ratio)`",
                       "`ep_id` `null` when that counter is unreadable",
                       "no `epics` band is written",
                       "every byte outside the top-level `epics:` block "
                       "kept, other epics' entries kept and this quote's "
                       "entries overwritten",
                       # the seed stays exact through the JSON rewrite; a
                       # scalar epics is refused, never a second key
                       "a `--seed` outside `0 <= seed < 2**53` `BadSeed`",
                       "the first 6 bytes of `sha256(\"<engagement>:<n>\")`",
                       "a top-level `epics:` scalar other than empty, `~`, "
                       "`null` or `{}`",
                       "`ScopeUnwritable` from `scope`, a retry from the "
                       "sync-back",
                       "— additive) |"):
            self.assertIn(phrase, clause)
        stories = next(line for line in self.text.splitlines()
                       if line.startswith("| Story / rulings"))
        self.assertIn("Story 32.5", stories)
        engage = next(line for line in self.text.splitlines()
                      if line.startswith("| `tk-studio-engage` "))
        for phrase in ("Stories 32.5 to 32.8 add the verbs `quote` and "
                       "`closeout`", "`quote`, 0.1.27, Story 32.5",
                       "`lib/engage.py quote` (Story 32.5)", "`NoScope`",
                       "`PricesUnreadable`", "`QuoteUnwritable`",
                       "voids a non-null `quote` first",
                       "not numbered 1..m in order", "`scope.lock is held`",
                       "`basis.notes` is a list of strings",
                       "`basis.epics[].ep_id` is `null`",
                       # the seed range and default
                       "an integer `0 <= seed < 2**53`, exact as a JSON "
                       "number; default the first 6 bytes of "
                       "`sha256(\"<engagement>:<n>\")`",
                       "`BadSeed` (a `--seed` outside `0 <= seed < 2**53`)",
                       "a top-level `epics:` scalar other than empty, `~`, "
                       "`null` or `{}`",
                       # the quote verb's result shape
                       "`{ok, dry_run, engagement, mode: \"quote\", quote, "
                       "bands, written[], notes[]}`",
                       "also on a dry run, `null` on a refusal before it is "
                       "computed",
                       "`bands` `{EP-NNN: usd}`",
                       # a failed void: the scope refuses, the sync-back
                       # (which never raises) retries
                       "a failed void refuses `ScopeUnwritable` from `scope` "
                       "and, from the sync-back, which never raises, ends "
                       "not applied with `retry: true`",
                       "the sync-back's `written[]` names a void that "
                       "landed before a later failure",
                       "a page version whose Markdown equals `scope.md` "
                       "replaces nothing and keeps the quote"):
            self.assertIn(phrase, engage)
        self.assertNotIn("a failed void refuses `ScopeUnwritable` with "
                         "`scope.md` untouched", engage)
        self.assertNotIn("default from `sha256(", engage)
        self.assertNotIn("every other byte", self.text)
        read = next(line for line in self.text.splitlines()
                    if line.startswith("| the engagement (Story 32.1, "
                                       "0.1.27) | `GET /engagements/{id}` |"))
        self.assertIn("`quote {band50, band85, band95, cap, basis, "
                      "computed_at}`", read)
        for phrase in ("`basis.epics[] {k, title, stories, ep_id}`",
                       "`ep_id` `null`", "`basis.notes` a list of strings",
                       "`thin history: <n> landed stories`"):
            self.assertIn(phrase, read)
        observe = next(line for line in self.text.splitlines()
                       if line.startswith("| `tk-studio-observe` |"))
        for field in ("kind", "story_key", "epic", "usd", "legs", "route",
                      "prices_date"):
            self.assertIn(f"`{field}`", observe)
        # the taxonomy row and the contract mention land together
        taxonomy = json.loads(
            (PLUGIN_ROOT / "contracts" / "events" / "taxonomy.v1.json")
            .read_text(encoding="utf-8"))
        fields = taxonomy["events"]["observation"]["payload"]
        for field, kind in (("kind", "string"), ("story_key", "string"),
                            ("epic", "number"), ("usd", "number"),
                            ("legs", "object"), ("route", "object"),
                            ("prices_date", "string")):
            self.assertEqual(fields[field]["type"], kind, field)
            self.assertFalse(fields[field]["required"], field)

    # --- Story 32.6: the same 0.1.27 entry adds approval and the first run —
    # the approve pass, `engagement/ENG-NNN`, the merge-gated first run, the
    # autonomy levels, `spend.runs_usd`, the cap and `track.py block --kind`
    # — additive, never a 0.1.28; every earlier pin kept.

    def test_0_1_27_story_32_6_adds_approval_and_the_first_run(self):
        header = next(line for line in self.text.splitlines()
                      if line.startswith("| **Contract version**"))
        self.assertIn("**0.1.27**", header)
        self.assertNotIn("**0.1.28**", self.text)
        self.assertLess(header.index("0.1.27 (Story 32.5) adds to this same "
                                     "entry"),
                        header.index("0.1.27 (Story 32.6) adds to this same "
                                     "entry"))
        self.assertEqual(header.count("0.1.27 (Story 32.6)"), 1)
        clause = " ".join(header[header.index("0.1.27 (Story 32.6)"):]
                          .split())
        for phrase in ("`approve {autonomy, base_ref?}`",
                       "never a chat line, a planner proposal or a timer",
                       "`apps/supervisor/src/approve.ts`",
                       "`engagement/ENG-NNN`",
                       "never switched or dirtied",
                       "never a force push",
                       "`engagement-approve {id, project, step, ok, "
                       "detail}`",
                       "`append`", "`sync`", "`job`", "`commit`", "`pr`",
                       "`queued`", "`engagement: ENG-NNN`",
                       "`### Story N.M:`", "`NoScope`",
                       "`StoryShape: <k>.<m>`", "`NotApproved`",
                       "`plansync.py sync --directory <worktree>`",
                       "`.tk-studio/jobs/run-epic-N.json`",
                       "the rest of the file kept byte for byte",
                       "`TK_SUPERVISOR_CONFIG` never written",
                       "`epic_bands_text`'s byte shape", "`no_band`",
                       "`NonFastForward`", "`detail.pr {number, url}`",
                       "`MERGED`", "with or without `base_ref`",
                       "`payload {engagement, project}`",
                       "highest-numbered `run-epic-*` entry",
                       "`engagement-run-queued {engagement, project, "
                       "run_id, job, after_run?}`",
                       "`launched` (`approved → in-progress`, once per "
                       "approval)", "`full`", "`steady`", "`ask`",
                       "`launch.py stop --graceful`", "`run-paused`",
                       "`run-resumed`", "`continue`",
                       "`spend.runs_usd`", "`total_cost_usd`",
                       "`spend.runs_usd >= quote.cap`",
                       "`cap` (`in-progress → partial`)",
                       "`runs_usd`, `cap`, `band85.usd` and `band95.usd`",
                       "one notifier line", "`engagement-cap`",
                       "`raise-cap`", "`--kind questions \\| cap \\| ask`",
                       "`engagement-issue {action: blocked, kind}`",
                       "`UnknownKind`", "`ReasonMissing`",
                       "closes only a `questions` block",
                       "no table row changes", "— additive) |"):
            self.assertIn(phrase, clause)
        stories = next(line for line in self.text.splitlines()
                       if line.startswith("| Story / rulings"))
        self.assertIn("Story 32.6", stories)
        row = next(line for line in self.text.splitlines()
                   if line.startswith("| the engagement's input (Story 32.1, "
                                      "0.1.27) | `POST /engagements/{id}/"
                                      "input` |"))
        for phrase in ("Story 32.6: an applied `approve` starts the approve "
                       "pass", "the first run queued once that PR merges",
                       "an applied `go` from `partial`"):
            self.assertIn(phrase, row)
        table = " ".join(self.text[self.text.index(
            "### The engagement state table (0.1.27, Story 32.1)"):]
            .split())
        self.assertNotIn("no route applies them in 0.1.27", table)
        self.assertIn("Story 32.6 `launched`, `run-paused`, `run-resumed` "
                      "and `cap`", table)
        track = next(line for line in self.text.splitlines()
                     if line.startswith("| `tk-studio-track` "))
        for phrase in ("Story 32.6: `kind?` (`questions` \\| `cap` \\| "
                       "`ask`, default `questions`)", "`--kind cap`",
                       "`--kind ask`", "need no open questions",
                       "`[~accountid:<owner>] Blocked: ENG-NNN <the "
                       "reason's first line>`", "`UnknownKind`",
                       "`ReasonMissing`", "the result carrying `kind`"):
            self.assertIn(phrase, track)
        # 32.4's engage row sentence kept verbatim
        engage = next(line for line in self.text.splitlines()
                      if line.startswith("| `tk-studio-engage` "))
        self.assertIn("Stories 32.5 to 32.8 add the verbs `quote` and "
                      "`closeout`", engage)
        self.assertNotIn("every other byte", self.text)

    def test_section_8_names_the_cli_drives(self):
        section = self.text[self.text.index("## 8. Conformance"):]
        flat = " ".join(section.split())
        for phrase in ("`cli_drives`", "outside `surfaces`",
                       "report's top-level `cli_drives` field",
                       "tk_studio_cli doctor --json",
                       "tools/installer/cli", "`not run` with a reason",
                       "status, intent, artifacts, reason",
                       "status-block.schema.json"):
            self.assertIn(phrase, flat)

    def test_section_6_states_the_folder_and_roster_rule(self):
        section = self._section("## 6. Drift-check invocation",
                                "## 7. Driver integration")
        for phrase in ("skills/tk-studio/", "plugin.json", "--channel",
                       "default `stable`",
                       "tools/installer/rosters/<channel>.json",
                       "developer checkout", "`case`", "`ok`", "`stale`",
                       "`missing`", "`shadowed`", "tk-studio update",
                       "tk-studio install",
                       "claude plugin uninstall tk-studio@<m> --scope user",
                       "`missing` > `shadowed` > `stale` > `ok`",
                       "installed_plugins.json"):
            self.assertIn(phrase, section)
        self.assertIn("never the source of the version or of loadability",
                      section)
        self.assertNotIn("/plugin marketplace update", section)
        # case is the folder-and-roster verdict alone; the guards raise
        # status only, and an error plane carries no case
        flat = " ".join(section.split())
        for phrase in ("`case` is the folder-and-roster verdict alone",
                       "can raise `status` without changing `case`",
                       "a plane whose `status` is `error` carries no `case`",
                       "`--channel <channel>` added when `--channel` is not "
                       "the default `stable`"):
            self.assertIn(phrase, flat)
        self.assertNotIn("still fold into the same plane", flat)
        # a catalog without a tk-studio entry is another project's own
        # marketplace: not a developer checkout, skipped, never error
        for phrase in ("present with a `tk-studio` entry",
                       "A catalog that lists no `tk-studio` entry is another "
                       "project's own marketplace, not a developer checkout: "
                       "the catalog comparison is skipped, never `error`"):
            self.assertIn(phrase, flat)

    def test_section_8_documents_from_archive(self):
        section = self.text[self.text.index("## 8. Conformance"):]
        for phrase in ("--from-archive <zip>", "CLAUDE_CONFIG_DIR",
                       "harness-loadable", "harness_loadable",
                       "skipped: --from-archive not given",
                       "outside the repository", "`..`"):
            self.assertIn(phrase, section)
        flat = " ".join(section.split())
        self.assertIn("the drive scripts and the status-block schema from "
                      "that folder", flat)
        self.assertIn("judged before any surface is driven", flat)

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
        # DW-1: §4 submit is id-only; DW-3: four-plane (five-plane since
        # Story 31.4's tracking plane) + unrunnable-core
        self.assertNotIn("a job definition (or the id", self.text)
        self.assertIn("id-only", self.text)
        self.assertIn("five-plane", self.text)
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
