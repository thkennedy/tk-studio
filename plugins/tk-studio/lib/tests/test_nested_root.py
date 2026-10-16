"""A nested studio project is a first-class root (Story 28.2, AD-21, driver contract 0.1.22).

One fixture holds an outer studio project and a nested one at apps/supervisor
(project_id: supervisor), standing in for the merged tk-studio before the
merge. Every surface is driven from apps/supervisor/sub/dir and must resolve
the nested root, never the outer one; nothing of the outer project's store
or plan counter is read or written from there. TK_STUDIO_HOME is isolated in
the temp dir; no network.
"""
from __future__ import annotations

import contextlib
import io
import json
import os
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

LIB = Path(__file__).resolve().parents[1]
PLUGIN_ROOT = LIB.parent
REPO_ROOT = PLUGIN_ROOT.parents[1]
DRIFT_CHECK = PLUGIN_ROOT / "skills" / "tk-studio-activate" / "scripts" / "drift_check.py"
METER_HOOK = REPO_ROOT / ".bmad-loop" / "plugins" / "studio-pipeline" / "meter_hook.py"

sys.path.insert(0, str(LIB))
import config as configlib  # noqa: E402
import job as joblib  # noqa: E402
import jobrun  # noqa: E402
import launch  # noqa: E402
import ledger  # noqa: E402
import meter  # noqa: E402
import observe  # noqa: E402
import plansync  # noqa: E402
import registry  # noqa: E402

EPICS_DOC = """# demo - Epic Breakdown

## Epic 1: First Epic

Epic one intro.

### Story 1.1: Alpha Story

Body alpha.
"""


class NestedRootTestCase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.base = Path(self._tmp.name).resolve()
        self._old_env = {k: os.environ.get(k) for k in ("TK_STUDIO_HOME", "TK_STUDIO_ROOT")}
        self.store = self.base / "store"
        os.environ["TK_STUDIO_HOME"] = str(self.store)
        os.environ.pop("TK_STUDIO_ROOT", None)
        self.outer = self.base / "outer"
        self.outer.mkdir()
        (self.outer / "plugins" / "tk-studio").mkdir(parents=True)
        configlib.standup_project_config(self.outer)
        self.nested = self.outer / "apps" / "supervisor"
        self.nested.mkdir(parents=True)
        configlib.standup_project_config(self.nested, project_id="supervisor")
        self.cwd = self.nested / "sub" / "dir"
        self.cwd.mkdir(parents=True)
        self.outer_store = self.store / "projects" / "outer"

    def tearDown(self):
        for key, value in self._old_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        self._tmp.cleanup()

    def _cli(self, main, argv) -> tuple[int, dict]:
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = main(argv)
        return code, json.loads(out.getvalue())

    def _drift(self, directory: Path, env_extra: dict | None = None) -> dict:
        env = {**os.environ, "TK_STUDIO_HOME": str(self.store), **(env_extra or {})}
        proc = subprocess.run(
            [sys.executable, str(DRIFT_CHECK), "--directory", str(directory),
             "--claude-home", str(self.base / "claude")],
            stdin=subprocess.DEVNULL, capture_output=True, text=True,
            encoding="utf-8", errors="replace", timeout=120, env=env,
            cwd=str(self.base))
        return json.loads(proc.stdout)

    def assertOuterStoreUntouched(self):
        self.assertFalse(self.outer_store.exists(),
                         f"the outer project's store was written: {self.outer_store}")


class RuleTests(NestedRootTestCase):
    """config.py — the one nearest-root rule and the I/O matrix."""

    def test_nested_cwd_resolves_the_nested_root(self):
        info = configlib.project_info(self.cwd)
        self.assertEqual(info, {"project_root": str(self.nested),
                                "studio_root": str(self.outer),
                                "nested": True, "project_id": "supervisor"})

    def test_outer_cwd_resolves_the_outer_root_not_nested(self):
        (self.outer / "x").mkdir()
        info = configlib.project_info(self.outer / "x")
        self.assertEqual(info["project_root"], str(self.outer))
        self.assertFalse(info["nested"])
        self.assertEqual(info["project_id"], "outer")

    def test_not_onboarded_folder_resolves_to_itself(self):
        lone = self.base / "lone" / "deep"
        lone.mkdir(parents=True)
        info = configlib.project_info(lone)
        self.assertEqual(info["project_root"], str(lone))
        self.assertFalse(info["nested"])
        self.assertIsNone(info["studio_root"])
        self.assertEqual(info["project_id"], "deep")

    def test_the_per_user_store_never_marks_a_project_root(self):
        # $HOME/.tk-studio is the per-user store; its config.yaml must not
        # make $HOME a studio project root (driver contract 0.1.22).
        home = self.base / "home"
        user_store = home / ".tk-studio"
        user_store.mkdir(parents=True)
        (user_store / "config.yaml").write_text("vcs: git\n", encoding="utf-8",
                                                newline="\n")
        os.environ["TK_STUDIO_HOME"] = str(user_store)
        loose = home / "work" / "loose"
        loose.mkdir(parents=True)
        info = configlib.project_info(loose)
        self.assertEqual(info["project_root"], str(loose))
        self.assertFalse(info["nested"])
        self.assertFalse(configlib.in_project(loose))
        self.assertEqual(configlib.find_project_root(home), home)
        self.assertFalse(configlib.in_project(home))
        proj = home / "proj"
        proj.mkdir()
        configlib.standup_project_config(proj, project_id="homeproj")
        inside = proj / "sub"
        inside.mkdir()
        info = configlib.project_info(inside)
        self.assertEqual(info["project_root"], str(proj))
        self.assertFalse(info["nested"])
        self.assertEqual(info["project_id"], "homeproj")
        planning = proj / "_bmad-output" / "planning-artifacts"
        planning.mkdir(parents=True)
        (planning / "epics.md").write_text(EPICS_DOC, encoding="utf-8", newline="\n")
        code, out = self._cli(plansync.main, ["normalize", "--directory", str(inside)])
        self.assertEqual(code, 0, out)
        self.assertTrue((proj / ".tk-studio" / "plan-counter.yaml").is_file())
        self.assertFalse((user_store / "plan-counter.yaml").exists())

    def test_a_missing_directory_is_taken_literally(self):
        # a not-checked-out or mistyped nested path must not walk up into the
        # enclosing project (AC2: nothing of the outer project is written).
        missing = self.outer / "apps" / "missing"
        self.assertEqual(configlib.find_project_root(missing), missing)
        code, out = self._cli(configlib.main, ["root", "--directory", str(missing)])
        self.assertEqual(code, 0, out)
        self.assertEqual(out["project_root"], str(missing))
        planning = self.outer / "_bmad-output" / "planning-artifacts"
        planning.mkdir(parents=True)
        (planning / "epics.md").write_text(EPICS_DOC, encoding="utf-8", newline="\n")
        outer_counter = self.outer / ".tk-studio" / "plan-counter.yaml"
        self.assertFalse(outer_counter.exists())
        self._cli(plansync.main, ["normalize", "--directory", str(missing)])
        self.assertFalse(outer_counter.exists())
        self.assertFalse((planning / "plan").exists())
        self.assertFalse(missing.exists())
        self.assertOuterStoreUntouched()

    def test_a_given_root_resolves_to_itself(self):
        self.assertEqual(configlib.find_project_root(self.nested), self.nested)
        self.assertEqual(configlib.find_project_root(self.outer), self.outer)

    def test_a_non_utf8_tracked_config_has_no_project_id(self):
        # an undecodable tracked config must not raise out of project_info, so
        # drift_check still ends with its JSON (AD-11)
        tracked = self.nested / ".tk-studio" / "config.yaml"
        tracked.write_bytes(b"vcs: git\nproject_id: \xff\xfe\x80\n")
        self.assertIsNone(configlib.tracked_project_id(self.nested))
        self.assertEqual(configlib.project_info(self.cwd)["project_id"], "supervisor")
        result = self._drift(self.cwd)
        self.assertEqual(result["project_root"], str(self.nested))
        self.assertEqual(result["project_id"], "supervisor")
        self.assertIn("planes", result)

    def test_studio_root_env_then_ancestor_then_none(self):
        elsewhere = self.base / "elsewhere"
        elsewhere.mkdir()
        os.environ["TK_STUDIO_ROOT"] = str(elsewhere)
        self.assertEqual(configlib.project_info(self.cwd)["studio_root"], str(elsewhere))
        os.environ.pop("TK_STUDIO_ROOT")
        self.assertEqual(configlib.project_info(self.cwd)["studio_root"], str(self.outer))
        self.assertIsNone(configlib.studio_root(self.base / "lone"))
        # never the plugin's own folder
        self.assertNotEqual(configlib.studio_root(self.cwd), configlib.PLUGIN_ROOT)

    def test_root_verb_prints_the_nested_root(self):
        os.environ["TK_STUDIO_ROOT"] = str(self.outer)
        code, out = self._cli(configlib.main, ["root", "--directory", str(self.cwd)])
        self.assertEqual(code, 0)
        self.assertEqual(out["project_root"], str(self.nested))
        self.assertTrue(out["nested"])
        self.assertEqual(out["project_id"], "supervisor")
        self.assertEqual(out["studio_root"], str(self.outer))

    def test_resolve_directory_walks_up_to_the_nested_config(self):
        tracked = self.nested / ".tk-studio" / "config.yaml"
        tracked.write_text(tracked.read_text(encoding="utf-8").replace(
            "vcs: git", "vcs: perforce"), encoding="utf-8", newline="\n")
        code, out = self._cli(configlib.main, ["resolve", "--key", "vcs",
                                               "--directory", str(self.cwd)])
        self.assertEqual(code, 0)
        self.assertEqual((out["value"], out["scope"]), ("perforce", "project-tracked"))
        code, out = self._cli(configlib.main, ["resolve", "--key", "vcs",
                                               "--directory", str(self.outer)])
        self.assertEqual(out["value"], "git")

    def test_standup_takes_directory_literally(self):
        new = self.outer / "apps" / "new"
        new.mkdir()
        code, out = self._cli(configlib.main, ["standup", "--directory", str(new)])
        self.assertEqual(code, 0)
        self.assertEqual(out["project_root"], str(new))
        self.assertTrue((new / ".tk-studio" / "config.yaml").is_file())
        self.assertEqual(configlib.project_info(new)["nested"], True)

    def test_job_project_key_is_the_config_rule(self):
        self.assertEqual(joblib.project_key(self.nested), "supervisor")
        self.assertEqual(joblib.project_key(self.nested), configlib.project_key(self.nested))
        self.assertEqual(joblib.project_key(self.outer), "outer")


class SurfaceTests(NestedRootTestCase):
    """AC1/AC2 — every surface from apps/supervisor/sub/dir."""

    def test_drift_check_reports_both_roots_and_names_the_nested_project(self):
        result = self._drift(self.cwd, {"TK_STUDIO_ROOT": str(self.outer)})
        self.assertEqual(result["project_root"], str(self.nested))
        self.assertEqual(result["studio_root"], str(self.outer))
        self.assertIs(result["nested"], True)
        self.assertEqual(result["project_id"], "supervisor")
        outer = self._drift(self.outer)
        self.assertIs(outer["nested"], False)
        self.assertEqual(outer["project_id"], "outer")
        # the status block shape is unchanged: the keys ride the core JSON only
        lone = self.base / "lone"
        lone.mkdir()
        self.assertIsNone(self._drift(lone, {"TK_STUDIO_ROOT": ""})["studio_root"])
        self.assertOuterStoreUntouched()

    def test_plansync_mints_into_the_nested_counter_only(self):
        for root in (self.outer, self.nested):
            planning = root / "_bmad-output" / "planning-artifacts"
            planning.mkdir(parents=True)
            (planning / "epics.md").write_text(EPICS_DOC, encoding="utf-8", newline="\n")
        code, _ = self._cli(plansync.main, ["normalize", "--directory", str(self.outer)])
        self.assertEqual(code, 0)
        outer_counter = self.outer / ".tk-studio" / "plan-counter.yaml"
        before = outer_counter.read_bytes()
        code, out = self._cli(plansync.main, ["normalize", "--directory", str(self.cwd)])
        self.assertEqual(code, 0, out)
        self.assertTrue((self.nested / ".tk-studio" / "plan-counter.yaml").is_file())
        self.assertTrue((self.nested / "_bmad-output" / "planning-artifacts" / "plan").is_dir())
        self.assertFalse((self.cwd / ".tk-studio").exists())
        self.assertEqual(outer_counter.read_bytes(), before)
        self.assertOuterStoreUntouched()

    def test_jobrun_reads_the_nested_config_and_store(self):
        tracked = self.nested / ".tk-studio" / "config.yaml"
        tracked.write_text(tracked.read_text(encoding="utf-8") + "\njobs:\n  - note\n",
                           encoding="utf-8", newline="\n")
        jobs = self.nested / ".tk-studio" / "jobs"
        jobs.mkdir()
        (jobs / "note.json").write_text(json.dumps({
            "job_schema_version": 1, "id": "note",
            "target": {"skill": "tk-studio-observe", "payload": {"source": "other"}},
            "trigger": "one-shot", "guards": {"max_turns": 2}, "stop": {"max_runs": 3},
        }), encoding="utf-8")
        code, out = self._cli(jobrun.main, ["resolve", "--directory", str(self.cwd)])
        self.assertEqual(code, 0, out)
        self.assertEqual([j["job_id"] for j in out["jobs"]], ["note"])
        code, out = self._cli(jobrun.main, ["submit", "--directory", str(self.cwd),
                                            "--id", "note"])
        self.assertEqual(code, 0, out)
        self.assertTrue(out["accepted"], out)
        self.assertTrue((self.store / "projects" / "supervisor" / "runs").is_dir())
        self.assertOuterStoreUntouched()

    def test_launch_check_resolves_the_nested_root(self):
        with mock.patch.object(launch, "_bmad_loop_binary", lambda: None):
            code, out = self._cli(launch.main, ["check", "--directory", str(self.cwd),
                                                "--epic", "1"])
        project = next(c for c in out["checks"] if c["check"] == "project")
        self.assertEqual(project["detail"], str(self.nested))
        spec = next(c for c in out["checks"] if c["check"] == "spec folder")
        self.assertIn(str(self.nested / "_bmad-output" / "specs" / "spec-epic-1"),
                      spec["detail"])
        self.assertOuterStoreUntouched()

    def test_observe_defaults_project_to_the_nested_id(self):
        old = Path.cwd()
        os.chdir(self.cwd)
        try:
            code, out = self._cli(observe.main, ["record", "--source", "other",
                                                 "--description", "nested toil"])
        finally:
            os.chdir(old)
        self.assertEqual(code, 0, out)
        self.assertEqual(out["envelope"]["project"], "supervisor")
        lone = self.base / "lone"
        lone.mkdir()
        os.chdir(lone)
        try:
            code, out = self._cli(observe.main, ["record", "--source", "other",
                                                 "--description", "no project"])
        finally:
            os.chdir(old)
        self.assertNotIn("project", out["envelope"])

    def test_meter_keys_a_nested_run_by_the_nested_project(self):
        run_dir = self.nested / ".bmad-loop" / "runs" / "20000101-000000-1"
        (run_dir / "events").mkdir(parents=True)
        key = "9-1-a-story"
        transcript = self.base / "claude" / "projects" / "-n" / "s-dev.jsonl"
        transcript.parent.mkdir(parents=True)
        transcript.write_text(json.dumps({"type": "assistant", "message": {
            "id": "m1", "model": "model-a", "usage": {
                "input_tokens": 1000, "output_tokens": 0, "cache_read_input_tokens": 0,
                "cache_creation_input_tokens": 0}}}) + "\n", encoding="utf-8")
        for n, event in enumerate(("SessionStart", "Stop"), 1):
            (run_dir / "events" / f"{n:04d}-{key}-dev-1-{event}.json").write_text(json.dumps(
                {"ts": n, "event": event, "task_id": f"{key}-dev-1", "session_id": "s-dev",
                 "transcript_path": str(transcript)}), encoding="utf-8")
        (run_dir / "state.json").write_text(json.dumps(
            {"tasks": {key: {"story_key": key, "attempt": 1}}}), encoding="utf-8")
        prices = self.base / "prices.json"
        prices.write_text(json.dumps({"date": "2000-01-01", "source": "fixture", "aliases": {},
                                      "models": {"model-a": {
                                          "input": 1.0, "output": 2.0, "cache_write_5m": 3.0,
                                          "cache_write_1h": 4.0, "cache_read": 5.0,
                                          "derived": []}}}), encoding="utf-8")
        # no --repo-root: the meter infers <run_dir>/../../.. — the nested root
        meter.meter_story(run_dir, key, prices_path=prices)
        lines = [json.loads(line) for line in
                 ledger.ledger_path().read_text(encoding="utf-8").splitlines() if line]
        self.assertEqual([e["project"] for e in lines if e["event"] == "observation"],
                         ["supervisor"])
        self.assertOuterStoreUntouched()

    def test_meter_hook_walks_up_to_the_studio_root(self):
        sys.path.insert(0, str(METER_HOOK.parent))
        try:
            import meter_hook  # noqa: E402
        finally:
            sys.path.remove(str(METER_HOOK.parent))
        meter_py = self.outer / "plugins" / "tk-studio" / "lib" / "meter.py"
        meter_py.parent.mkdir(parents=True)
        meter_py.write_text("", encoding="utf-8")
        found = meter_hook._studio_root({"BMAD_LOOP_REPO_ROOT": str(self.nested)})
        self.assertEqual(found, self.outer)
        self.assertEqual(meter_hook._studio_root({"TK_STUDIO_ROOT": str(self.base),
                                                  "BMAD_LOOP_REPO_ROOT": str(self.nested)}),
                         self.base)
        self.assertIsNone(meter_hook._studio_root({"BMAD_LOOP_REPO_ROOT": str(self.base)}))


class RegistryAgreementTests(NestedRootTestCase):
    """AC2 — registry, activation and launch agree on the nested root."""

    def test_register_reads_the_tracked_project_id(self):
        result = registry.register(self.nested, writer="onboard")
        self.assertEqual(result["project_id"], "supervisor")
        self.assertEqual(result["entry"]["root"], str(self.nested))
        # an explicit --project-id still wins; a config-less root keys by basename
        lone = self.base / "lone"
        lone.mkdir()
        self.assertEqual(registry.register(lone, writer="onboard")["project_id"], "lone")

    def test_register_refuses_a_second_key_for_a_registered_root(self):
        # AD-20 never a silent second identity: an explicit --project-id naming
        # a key other than the root's existing entry exits 2, even when it is
        # the tracked project_id.
        registry.register(self.nested, writer="onboard", project_id="old-key")
        before = registry.registry_path().read_bytes()
        with self.assertRaises(registry.RegistryError) as ctx:
            registry.register(self.nested, writer="activate", project_id="supervisor")
        self.assertIn("'old-key'", str(ctx.exception))
        code, out = self._cli(registry.main, ["register", "--directory", str(self.nested),
                                              "--writer", "onboard",
                                              "--project-id", "third"])
        self.assertEqual(code, 2, out)
        self.assertIn("'old-key'", out["error"])
        self.assertEqual(registry.registry_path().read_bytes(), before)
        self.assertEqual(set(registry.list_projects()), {"old-key"})

    def test_register_without_id_reaffirms_the_existing_key(self):
        # onboard's register step is idempotent: a root held under its basename
        # whose tracked project_id differs is re-affirmed, not refused.
        renamed = self.base / "renamed-root"
        renamed.mkdir()
        configlib.standup_project_config(renamed, project_id="tracked-id")
        registry.register(renamed, writer="onboard", project_id="renamed-root")
        before = registry.registry_path().read_bytes()
        code, out = self._cli(registry.main, ["register", "--directory", str(renamed),
                                              "--writer", "onboard"])
        self.assertEqual(code, 0, out)
        self.assertEqual((out["project_id"], out["action"]), ("renamed-root", "unchanged"))
        self.assertEqual(registry.registry_path().read_bytes(), before)
        holders = [k for k, e in registry.list_projects().items()
                   if e["root"] == str(renamed)]
        self.assertEqual(holders, ["renamed-root"])

    def test_register_takes_directory_literally(self):
        with self.assertRaises(registry.RegistryError):
            registry.register(self.cwd / "missing", writer="onboard")
        result = registry.register(self.cwd, writer="onboard")
        self.assertEqual(result["entry"]["root"], str(self.cwd))
        self.assertEqual(result["project_id"], "dir")

    def test_register_without_id_at_a_new_root_names_the_repoint(self):
        # AC2 migration: the tracked identity is held at an old root; the
        # advice is the re-point, never a second --project-id (AD-20).
        old = self.base / "old-supervisor"
        old.mkdir()
        registry.register(old, writer="onboard", project_id="supervisor")
        before = registry.registry_path().read_bytes()
        code, out = self._cli(registry.main, ["register", "--directory", str(self.nested),
                                              "--writer", "onboard"])
        self.assertEqual(code, 2, out)
        self.assertIn(f"registry.py amend --project-id supervisor --writer onboard "
                      f"--root {self.nested}", out["error"])
        self.assertNotIn("explicit --project-id", out["error"])
        self.assertEqual(registry.registry_path().read_bytes(), before)
        # a basename key (no tracked id) keeps the explicit --project-id hint
        other = self.base / "elsewhere" / "supervisor"
        other.mkdir(parents=True)
        with self.assertRaises(registry.RegistryError) as ctx:
            registry.register(other, writer="onboard")
        self.assertIn("explicit --project-id", str(ctx.exception))

    def test_show_activation_and_launch_agree_on_the_root(self):
        self._cli(registry.main, ["register", "--directory", str(self.nested),
                                  "--writer", "onboard"])
        code, out = self._cli(registry.main, ["amend", "--project-id", "supervisor",
                                              "--writer", "activate",
                                              "--vault-link", "unconfigured"])
        self.assertEqual(code, 0, out)
        code, shown = self._cli(registry.main, ["show", "--project-id", "supervisor"])
        self.assertEqual(code, 0)
        root = shown["entry"]["root"]
        self.assertEqual(root, str(self.nested))
        activation = self._drift(self.cwd)
        self.assertEqual(activation["project_root"], root)
        vault = next(p for p in activation["planes"] if p["plane"] == "vault")
        self.assertIn("supervisor", vault["detail"])
        self.assertNotIn("not registered", vault["detail"])
        with mock.patch.object(launch, "_bmad_loop_binary", lambda: None):
            _, checked = self._cli(launch.main, ["check", "--directory", str(self.cwd),
                                                 "--epic", "1"])
        project = next(c for c in checked["checks"] if c["check"] == "project")
        self.assertEqual(project["detail"], root)
        self.assertEqual(set(registry.list_projects()), {"supervisor"})
        self.assertOuterStoreUntouched()

    def _snapshot_outer_counter(self):
        counter = self.outer / ".tk-studio" / "plan-counter.yaml"
        return counter.read_bytes() if counter.is_file() else None

    def test_amend_root_repoints_the_identity_at_the_nested_root(self):
        # AC2 literally: supervisor registered at an old, separate root, then
        # `registry.py amend --root` re-points it at the nested root.
        old = self.base / "old-supervisor"
        old.mkdir()
        code, out = self._cli(registry.main, ["register", "--directory", str(old),
                                              "--writer", "onboard",
                                              "--project-id", "supervisor"])
        self.assertEqual(code, 0, out)
        self.assertEqual(out["entry"]["root"], str(old))
        counter_before = self._snapshot_outer_counter()
        code, out = self._cli(registry.main, ["amend", "--project-id", "supervisor",
                                              "--writer", "activate",
                                              "--root", str(self.nested)])
        self.assertEqual(code, 0, out)
        self.assertEqual(out["action"], "amended")
        code, shown = self._cli(registry.main, ["show", "--project-id", "supervisor"])
        self.assertEqual(code, 0)
        root = shown["entry"]["root"]
        self.assertEqual(root, str(self.nested))
        activation = self._drift(self.cwd)
        self.assertEqual(activation["project_id"], "supervisor")
        self.assertEqual(activation["project_root"], root)
        vault = next(p for p in activation["planes"] if p["plane"] == "vault")
        self.assertIn("supervisor", vault["detail"])
        self.assertNotIn("not registered", vault["detail"])
        with mock.patch.object(launch, "_bmad_loop_binary", lambda: None):
            _, checked = self._cli(launch.main, ["check", "--directory", str(self.cwd),
                                                 "--epic", "1"])
        project = next(c for c in checked["checks"] if c["check"] == "project")
        self.assertEqual(project["detail"], root)
        self.assertEqual(set(registry.list_projects()), {"supervisor"})
        self.assertEqual(self._snapshot_outer_counter(), counter_before)
        self.assertOuterStoreUntouched()

    def test_amend_root_refuses_a_folder_without_a_studio_config(self):
        old = self.base / "old-supervisor"
        old.mkdir()
        registry.register(old, writer="onboard", project_id="supervisor")
        before = registry.registry_path().read_bytes()
        code, out = self._cli(registry.main, ["amend", "--project-id", "supervisor",
                                              "--writer", "activate",
                                              "--root", str(self.cwd)])
        self.assertEqual(code, 2, out)
        self.assertFalse(out["ok"])
        self.assertIn("config.yaml", out["error"])
        self.assertEqual(registry.registry_path().read_bytes(), before)

    def test_amend_root_refuses_the_per_user_store_parent(self):
        # $HOME/.tk-studio is the per-user store; it never marks $HOME a
        # project root, so amend --root $HOME is refused (contract 0.1.22).
        home = self.base / "home"
        user_store = home / ".tk-studio"
        user_store.mkdir(parents=True)
        (user_store / "config.yaml").write_text("vcs: git\n", encoding="utf-8",
                                                newline="\n")
        os.environ["TK_STUDIO_HOME"] = str(user_store)
        old = self.base / "old-home"
        old.mkdir()
        registry.register(old, writer="onboard", project_id="home")
        before = registry.registry_path().read_bytes()
        code, out = self._cli(registry.main, ["amend", "--project-id", "home",
                                              "--writer", "activate",
                                              "--root", str(home)])
        self.assertEqual(code, 2, out)
        self.assertFalse(out["ok"])
        self.assertIn("no studio project config", out["error"])
        self.assertEqual(registry.registry_path().read_bytes(), before)
        self.assertEqual(registry.list_projects()["home"]["root"], str(old))

    def test_amend_root_refuses_a_root_another_entry_holds(self):
        old = self.base / "old-supervisor"
        old.mkdir()
        registry.register(old, writer="onboard", project_id="supervisor")
        registry.register(self.nested, writer="onboard", project_id="squatter")
        before = registry.registry_path().read_bytes()
        code, out = self._cli(registry.main, ["amend", "--project-id", "supervisor",
                                              "--writer", "activate",
                                              "--root", str(self.nested)])
        self.assertEqual(code, 2, out)
        self.assertFalse(out["ok"])
        self.assertIn("'squatter'", out["error"])
        self.assertEqual(registry.registry_path().read_bytes(), before)

    def test_amend_root_repoints_a_raw_basename_key(self):
        # a key stored raw ('old dir') must still match its new root, whose
        # sanitised identity is 'old_dir'.
        old = self.base / "first" / "old dir"
        old.mkdir(parents=True)
        result = registry.register(old, writer="onboard")
        self.assertEqual(result["project_id"], "old dir")
        new = self.base / "second" / "old dir"
        new.mkdir(parents=True)
        configlib.standup_project_config(new)
        self.assertIsNone(configlib.tracked_project_id(new))
        code, out = self._cli(registry.main, ["amend", "--project-id", "old dir",
                                              "--writer", "activate",
                                              "--root", str(new)])
        self.assertEqual(code, 0, out)
        code, shown = self._cli(registry.main, ["show", "--project-id", "old dir"])
        self.assertEqual(code, 0, shown)
        self.assertEqual(shown["entry"]["root"], str(new))

    def test_amend_root_refuses_a_mismatched_project_id(self):
        old = self.base / "old-supervisor"
        old.mkdir()
        registry.register(old, writer="onboard", project_id="supervisor")
        before = registry.registry_path().read_bytes()
        code, out = self._cli(registry.main, ["amend", "--project-id", "supervisor",
                                              "--writer", "activate",
                                              "--root", str(self.outer)])
        self.assertEqual(code, 2, out)
        self.assertFalse(out["ok"])
        self.assertIn("'outer'", out["error"])
        self.assertEqual(registry.registry_path().read_bytes(), before)
        # the root rewrite stays writer-gated
        code, out = self._cli(registry.main, ["amend", "--project-id", "supervisor",
                                              "--writer", "launch",
                                              "--root", str(self.nested)])
        self.assertEqual(code, 2, out)
        self.assertEqual(registry.registry_path().read_bytes(), before)


class LaunchSkillTests(unittest.TestCase):
    """AC1 — the launch skill resolves <root> through config.py's root verb
    before any step reads or passes it."""

    def test_launch_skill_resolves_root_via_the_config_root_verb(self):
        text = (PLUGIN_ROOT / "skills" / "tk-studio-launch" / "SKILL.md").read_text(
            encoding="utf-8")
        verb = 'lib/config.py" root --directory <directory>'
        self.assertIn(verb, text)
        definition = text.index("`<root>` = the `project_root` printed by")
        self.assertLess(text.index(verb), text.index("pipeline.py\" apply --directory <root>"))
        first_use = min(text.index(m) for m in ("<root>/", "--directory <root>"))
        self.assertLess(definition, first_use)


class HooksTests(unittest.TestCase):
    """AC3 — every hook in the repository's .claude/settings.json resolves its
    script through $CLAUDE_PROJECT_DIR, so the same file in the nested root
    runs the nested scripts (live firing is unverifiable here)."""

    def test_every_hook_command_is_claude_project_dir_relative(self):
        settings = json.loads((REPO_ROOT / ".claude" / "settings.json")
                              .read_text(encoding="utf-8"))
        commands = [hook["command"] for groups in settings["hooks"].values()
                    for group in groups for hook in group["hooks"]
                    if hook.get("type") == "command"]
        self.assertTrue(commands)
        for command in commands:
            scripts = re.findall(r"(\S+\.py)\b", command)
            self.assertTrue(scripts, command)
            for script in scripts:
                self.assertTrue(script.startswith('"$CLAUDE_PROJECT_DIR"/'),
                                f"hook script not $CLAUDE_PROJECT_DIR-relative: {command}")


if __name__ == "__main__":
    unittest.main()
