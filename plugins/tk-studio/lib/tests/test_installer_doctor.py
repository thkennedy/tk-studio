"""``tk-studio doctor`` (Story 25.5): every row of the story's I/O matrix,
the read-only invariant, the store verdict pinned to the drift check's, the
``--json`` shape and the conformance CLI drive.

Offline by construction: the fakes and the socket guard of
``test_installer_apps``; ``claude``, ``sbx`` and ``git`` are fake
executables on a temp PATH, answered by the fake runner.
"""
from __future__ import annotations

import io
import json
import os
import ssl
import subprocess
import sys
import unittest
from contextlib import redirect_stdout
from datetime import datetime, timezone
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_installer_apps import (  # noqa: E402
    LINUX, PLUGIN_ROOT, REPO_ROOT, ROSTERS, WINDOWS, AppsCase, FakeHost,
    cli_main, done, drift_check, lnk_bytes)

sys.path.insert(0, str(PLUGIN_ROOT / "lib"))
sys.path.insert(0, str(PLUGIN_ROOT / "contracts" / "conformance"))
import runner as conformance  # noqa: E402
import skills_plane  # noqa: E402
import store as lib_store  # noqa: E402

from tk_studio_cli import doctor  # noqa: E402

NOW = 2_000_000_000.0
DAY = 86400
ALLOWED = {"claude --version", "sbx daemon status",
           "git config --global --get core.longpaths"}
SCHEMA = json.loads((PLUGIN_ROOT / "contracts" / "status-block.schema.json")
                    .read_text(encoding="utf-8"))
AC1 = ("claude-code", "plugin", "store", "sbx-daemon", "long-paths",
       "path-launcher", "tailscale-cert", "supervisor")


class DoctorHost(FakeHost):
    """FakeHost plus the three processes doctor may start."""

    def __init__(self):
        super().__init__()
        self.claude_out = "2.1.230 (Claude Code)\n"
        self.sbx_rc = 0
        self.longpaths: str | None = "true"     # None: unset (exit 1)
        # Story 33.2: `sbx ls` and the two in-sandbox reads
        self.sbx_ls = "SANDBOX            AGENT   STATUS\n"
        self.auth_out = json.dumps({"loggedIn": True,
                                    "authMethod": "claude.ai"})
        self.expiry_out = ""
        self.exec_timeout = False   # an `sbx exec` that times out

    def __call__(self, args, env=None):
        args = [str(a) for a in args]
        name = Path(args[0]).name.removesuffix(".exe")
        if name == "claude" and args[1:] == ["--version"]:
            self.calls.append((args, env))
            return done(args, 0, self.claude_out)
        if name == "sbx" and args[1:2] == ["ls"]:
            self.calls.append((args, env))
            return done(args, 0, self.sbx_ls)
        if name == "sbx" and args[1:2] == ["exec"]:
            self.calls.append((args, env))
            if self.exec_timeout:
                raise subprocess.TimeoutExpired(args, 20)
            if "auth" in args:
                return done(args, 0, self.auth_out + "\n")
            return done(args, 0, self.expiry_out + "\n")
        if name == "sbx":
            self.calls.append((args, env))
            return done(args, self.sbx_rc, "running" if not self.sbx_rc
                        else "", "daemon not running" if self.sbx_rc else "")
        if name == "git":
            self.calls.append((args, env))
            if self.longpaths is None:
                return done(args, 1)
            return done(args, 0, self.longpaths + "\n")
        return super().__call__(args, env)


class DoctorCase(AppsCase):
    plat = LINUX

    def setUp(self):
        super().setUp()
        self.host = DoctorHost()
        self.host.root = self.root
        self.fakebin = self.tmp / "fakebin"
        self.fakebin.mkdir()
        self.tools("claude", "sbx", "git")
        self.env["PATH"] = str(self.fakebin)
        self.env["TK_STUDIO_HOME"] = str(self.tmp / "store")
        self.hklm_value: object = 1

    def tools(self, *names):
        for name in names:
            for exe in (name, f"{name}.exe"):
                path = self.fakebin / exe
                path.write_text("#!/bin/sh\n")
                path.chmod(0o755)

    def drop_tools(self, *names):
        for name in names:
            for exe in (name, f"{name}.exe"):
                (self.fakebin / exe).unlink()

    def doctor(self, *extra, roster: Path | None = None, **kw):
        argv = ["doctor", *extra]
        if roster is not None:
            argv += ["--roster", str(roster)]
        kw.setdefault("now", lambda: NOW)
        kw.setdefault("hklm", lambda key, name: self.hklm_value)
        return self.run_cli(argv, **kw)

    def checks(self, result) -> dict[str, dict]:
        return {c["check"]: c for c in result["checks"]}

    def snapshot(self) -> dict:
        return {str(p): (p.read_bytes() if p.is_file() else None)
                for p in sorted(self.tmp.rglob("*"))}

    def commands(self) -> list[str]:
        return [" ".join([Path(a[0]).name.removesuffix(".exe"), *a[1:]])
                for a, _ in self.host.calls]

    # --- fixtures ----------------------------------------------------------

    def plugin_folder(self, version: str):
        folder = self.config / "skills" / "tk-studio" / ".claude-plugin"
        folder.mkdir(parents=True, exist_ok=True)
        (folder / "plugin.json").write_text(json.dumps(
            {"name": "tk-studio", "version": version}), encoding="utf-8")

    def store_tree(self, config: str | None = "user_name: tim\n"
                   "role: developer\nmachine_id: box\n",
                   dirs=lib_store.STORE_DIRS):
        root = Path(self.env["TK_STUDIO_HOME"])
        root.mkdir(parents=True, exist_ok=True)
        for d in dirs:
            (root / d).mkdir(exist_ok=True)
        if config is not None:
            (root / "config.yaml").write_text(config, encoding="utf-8")
        return root

    def registry(self, projects: dict[str, str] | None):
        path = Path(self.env["TK_STUDIO_HOME"]) / "registry" / "projects.yaml"
        path.parent.mkdir(parents=True, exist_ok=True)
        lines = ["registry_version: 1"]
        if projects:
            lines.append("projects:")
            for pid, root in projects.items():
                lines += [f"  {pid}:", f"    root: '{root}'"]
        else:
            lines.append("projects:")
        path.write_text("\n".join(lines) + "\n", encoding="utf-8")
        return path

    def trust(self, roots: dict[str, bool]):
        (self.config / ".claude.json").write_text(json.dumps({"projects": {
            root: {"hasTrustDialogAccepted": ok}
            for root, ok in roots.items()}}), encoding="utf-8")

    def cert(self, age_days: float) -> Path:
        path = self.tmp / "tls" / "box.ts.net.crt"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("not a pem\n")
        os.utime(path, (NOW - age_days * DAY,) * 2)
        return path

    def engine_sandbox(self, name: str = "claude-tk-studio",
                       days_left: float | None = 30,
                       running: bool = True) -> Path:
        """Story 33.2: a supervisor config naming one sandbox, listed by
        the fake `sbx ls`, its refresh token expiring ``days_left`` from
        NOW (milliseconds since the epoch; None: no field)."""
        path = self.tmp / "supervisor.yaml"
        path.write_text('jobs:\n  "tk-studio/run-epic":\n    tier: sbx\n'
                        f'    sandbox: {name}\n', encoding="utf-8")
        self.env["TK_SUPERVISOR_CONFIG"] = str(path)
        state = "running" if running else "stopped"
        self.host.sbx_ls = ("SANDBOX            AGENT   STATUS\n"
                            f"{name}   claude  {state}\n")
        self.host.expiry_out = "" if days_left is None \
            else str(int((NOW + days_left * DAY) * 1000))
        return path

    def supervisor_log(self, lines: list[str], day: str = "2033-05-18"
                       ) -> Path:
        """Story 33.1: a day file under ``TK_SUPERVISOR_WORK`` (set here)."""
        work = self.tmp / "work"
        self.env["TK_SUPERVISOR_WORK"] = str(work)
        path = work / "supervisor" / "logs" / f"supervisor-{day}.log"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("".join(f"{line}\n" for line in lines),
                        encoding="utf-8")
        return path


class AllFailing(DoctorCase):
    plat = WINDOWS

    def test_every_check_fails_with_a_fix_and_nothing_changes(self):
        roster = self.full_roster()
        self.host.claude_out = "2.1.100 (Claude Code)\n"
        self.host.sbx_rc = 1
        self.host.longpaths = None
        self.hklm_value = 0
        self.registry({"demo": "C:\\GitHub\\demo"})
        self.trust({"C:/GitHub/other": True})
        self.store.values["TK_SUPERVISOR_TLS_CERT"] = str(self.cert(120))
        sup = self.root / "supervisor" / "0.1.0"
        sup.mkdir(parents=True)
        gone = self.root / "studio-web" / ".0.1.0.previous"
        gone.mkdir(parents=True)
        (self.root / "supervisor" / ".0.0.9.previous").mkdir()
        (self.root / "current.json").write_text(json.dumps({
            "supervisor": {"version": "0.1.0", "path": str(sup)},
            "studio-web": {"version": "0.1.0", "path": str(gone)}}))
        (self.config / "skills" / ".tk-studio.new").mkdir(parents=True)
        tools = self.root / "tools"
        tools.mkdir()
        (tools / "cli-update.cmd").write_text("rem helper\n")
        (tools / "cli-update.log").write_text("install failed: exit 2\n")
        hermes = self.tmp / "local" / "hermes"
        hermes.mkdir(parents=True)
        (hermes / "config.yaml").write_text(
            "auth:\n  adopt_external_logins: true\n")
        before = self.snapshot()

        result, code = self.doctor(roster=roster)

        self.assertEqual((code, result["status"]), (0, "complete"))
        checks = self.checks(result)
        for name in (*AC1, "folder-trust:demo", "studio-web"):
            with self.subTest(check=name):
                self.assertEqual(checks[name]["status"], "fail",
                                 checks[name])
                self.assertTrue(checks[name]["fix"])
        for name in ("hermes-logins", "plugin-leftovers", "stale-slots",
                     "cli-update-helper"):
            with self.subTest(check=name):
                self.assertEqual(checks[name]["status"], "warn")
                self.assertTrue(checks[name]["fix"])
        self.assertIn("adopt_external_logins", checks["hermes-logins"]
                      ["detail"])
        self.assertIn("Claude-login risk", checks["hermes-logins"]["detail"])
        self.assertIn("DW-12", checks["studio-web"]["detail"])
        self.assertIn("install failed", checks["cli-update-helper"]["detail"])
        self.assertEqual(set(self.commands()), ALLOWED)
        self.assertEqual(len(self.host.calls), 3)
        self.assertEqual(self.snapshot(), before, "doctor is read-only")
        self.assertEqual(self.store.values.keys(), {"TK_SUPERVISOR_TLS_CERT"})
        failing = [c["check"] for c in result["checks"]
                   if c["status"] == "fail"]
        self.assertEqual(result["reason"],
                         "failing checks: " + ", ".join(failing))


class AllPassing(DoctorCase):
    def test_a_healthy_box_passes_every_check(self):
        roster = self.full_roster()
        self.run_cli(["install", "--roster", str(roster)])
        self.host.calls.clear()
        self.store_tree()
        project = self.tmp / "proj"
        self.registry({"proj": str(project)})
        self.trust({str(project): True})
        (self.root / "bin").mkdir(exist_ok=True)
        (self.root / "bin" / "tk-studio").write_text("cli")
        self.env["PATH"] += os.pathsep + str(self.root / "bin")
        self.env["TK_SUPERVISOR_TLS_CERT"] = str(self.cert(10))
        self.supervisor_log([f"{stamp(NOW - 60)} [pacer] stopped (Ctrl+C)"])
        self.engine_sandbox()   # Story 33.2: the engine sandbox, 30 days left
        before = self.snapshot()
        result, code = self.doctor(roster=roster)
        self.assertEqual((code, result["reason"]), (0, None), result)
        statuses = {c["check"]: c["status"] for c in result["checks"]}
        self.assertEqual(statuses.pop("long-paths"), "skipped")
        self.assertEqual(set(statuses.values()), {"pass"}, statuses)
        self.assertEqual(sorted(statuses), sorted(
            ["claude-code", "plugin", "store", "sbx-daemon",
             "sandbox-login", "folder-trust:proj", "path-launcher",
             "tailscale-cert", "supervisor", "supervisor-log",
             "studio-web"]))
        for check in result["checks"]:
            if check["status"] == "pass":
                self.assertIsNone(check["fix"])
        self.assertEqual([c[:25] for c in self.commands()],
                         ["claude --version", "sbx daemon status",
                          "sbx ls", "sbx exec claude-tk-studio",
                          "sbx exec claude-tk-studio"])
        self.assertEqual(self.snapshot(), before)
        self.assertTrue(result["probe"]["answers"])
        self.assertTrue(result["probe"]["url"].startswith("https://"))


class ClaudeCode(DoctorCase):
    def test_pass_names_both_versions(self):
        check = self.checks(self.doctor(roster=self.full_roster())[0])[
            "claude-code"]
        self.assertEqual((check["status"], check["detail"]),
                         ("pass", "2.1.230 >= 2.1.224"))

    def test_below_the_floor_fails_naming_it(self):
        self.host.claude_out = "2.1.9 (Claude Code)"
        check = self.checks(self.doctor(roster=self.full_roster())[0])[
            "claude-code"]
        self.assertEqual(check["status"], "fail")
        self.assertIn(">=2.1.224", check["fix"])

    def test_not_found_or_unparseable_fails(self):
        roster = self.full_roster()
        self.host.claude_out = "Claude Code"
        check = self.checks(self.doctor(roster=roster)[0])["claude-code"]
        self.assertEqual(check["status"], "fail")
        self.drop_tools("claude")
        self.host.calls.clear()
        check = self.checks(self.doctor(roster=roster)[0])["claude-code"]
        self.assertEqual(check["status"], "fail")
        self.assertIn("not found", check["detail"])
        self.assertNotIn("claude --version", self.commands())

    def test_a_roster_refusal_fails_naming_it(self):
        bad = json.loads(self.full_roster().read_text())
        bad["requires"] = {"claude-code": "2.1"}
        invalid = self.tmp / "invalid.json"
        invalid.write_text(json.dumps(bad))
        entry = json.loads(self.full_roster().read_text())
        entry["components"]["supervisor"]["sha256"] = "nope"
        entry_bad = self.tmp / "entry.json"
        entry_bad.write_text(json.dumps(entry))
        for path, name in ((invalid, "RosterInvalid"),
                           (entry_bad, "RosterEntryInvalid"),
                           (self.tmp / "absent.json", "RosterUnreadable")):
            with self.subTest(refusal=name):
                result, code = self.doctor(roster=path)
                self.assertEqual((code, result["status"]), (0, "complete"))
                for key in ("claude-code", "plugin"):
                    check = self.checks(result)[key]
                    self.assertEqual(check["status"], "fail")
                    self.assertIn(name, check["fix"])

    def test_no_roster_fetches_the_channel_url(self):
        result, _ = self.doctor()
        self.assertEqual(self.fetch.calls, [
            "https://raw.githubusercontent.com/thkennedy/tk-studio/main/"
            "tools/installer/rosters/stable.json"])
        self.assertIn("RosterUnreadable",
                      self.checks(result)["claude-code"]["fix"])


class PluginPlane(DoctorCase):
    def test_ok_is_pass_and_carries_the_case(self):
        self.plugin_folder("0.2.16")
        check = self.checks(self.doctor(roster=self.full_roster())[0])[
            "plugin"]
        self.assertEqual((check["status"], check["case"]), ("pass", "ok"))

    def test_stale_names_the_channel(self):
        self.plugin_folder("0.2.15")
        check = self.checks(self.doctor(
            roster=ROSTERS / "latest.json")[0])["plugin"]
        self.assertEqual((check["status"], check["case"]), ("fail", "stale"))
        self.assertIn("--channel latest", check["fix"])

    def test_missing_includes_a_folder_without_plugin_json(self):
        (self.config / "skills" / "tk-studio").mkdir(parents=True)
        check = self.checks(self.doctor(roster=self.full_roster())[0])[
            "plugin"]
        self.assertEqual((check["status"], check["case"]), ("fail", "missing"))
        self.assertIn("tk-studio install", check["fix"])

    def test_shadowed_names_each_uninstall(self):
        self.plugin_folder("0.2.16")
        (self.config / "settings.json").write_text(json.dumps(
            {"enabledPlugins": {"tk-studio@tk-studio": True}}))
        before = (self.config / "settings.json").read_bytes()
        check = self.checks(self.doctor(roster=self.full_roster())[0])[
            "plugin"]
        self.assertEqual((check["status"], check["case"]),
                         ("fail", "shadowed"))
        self.assertIn("claude plugin uninstall tk-studio@tk-studio",
                      check["fix"])
        self.assertEqual((self.config / "settings.json").read_bytes(), before)

    def test_error_carries_no_case_and_names_the_path(self):
        self.plugin_folder("0.2.16")
        (self.config / "settings.json").write_text("{not json")
        check = self.checks(self.doctor(roster=self.full_roster())[0])[
            "plugin"]
        self.assertEqual(check["status"], "fail")
        self.assertNotIn("case", check)
        self.assertIn(str(self.config / "settings.json"), check["detail"])
        self.assertTrue(check["fix"])

    def test_not_shipped_is_skipped(self):
        roster = self.roster(uv=self.uv())
        check = self.checks(self.doctor(roster=roster)[0])["plugin"]
        self.assertEqual((check["status"], check["detail"]),
                         ("skipped", "not shipped in stable"))

    def test_the_plane_is_the_drift_checks(self):
        self.assertIs(drift_check.skills_dir_check,
                      skills_plane.skills_dir_check)
        self.plugin_folder("0.2.15")
        ours = doctor.skills_plane.skills_dir_check(
            self.config, ("0.2.16", "stable roster tk-studio--v0.2.16"))
        theirs = skills_plane.skills_dir_check(
            self.config, ("0.2.16", "stable roster tk-studio--v0.2.16"))
        self.assertEqual(ours, theirs)

    def test_leftovers_warn_and_stay(self):
        for name in (".tk-studio.retired", ".tk-studio.new"):
            (self.config / "skills" / name).mkdir(parents=True)
        check = self.checks(self.doctor(roster=self.full_roster())[0])[
            "plugin-leftovers"]
        self.assertEqual(check["status"], "warn")
        self.assertIn(".tk-studio.retired", check["detail"])
        self.assertIn(".tk-studio.new", check["detail"])
        self.assertTrue((self.config / "skills" / ".tk-studio.new").is_dir())

    def test_no_leftovers_is_not_reported(self):
        self.assertNotIn("plugin-leftovers", self.checks(
            self.doctor(roster=self.full_roster())[0]))


class StoreParity(DoctorCase):
    """The CLI's store check is the drift check's store plane."""

    def assert_same(self):
        with mock.patch.dict(os.environ,
                             {"TK_STUDIO_HOME": self.env["TK_STUDIO_HOME"]}):
            theirs = drift_check.check_store()
        ours = doctor.store_plane(self.env)
        self.assertEqual(ours, theirs)
        check = self.checks(self.doctor(roster=self.full_roster())[0])[
            "store"]
        self.assertEqual(check["detail"], theirs["detail"])
        self.assertEqual(check["status"],
                         "pass" if theirs["status"] == "ok" else "fail")
        if theirs["status"] != "ok":
            self.assertEqual(check["fix"], drift_check.FIX_STORE)
        return theirs["status"]

    def test_constants_are_the_libs(self):
        self.assertEqual(doctor.STORE_DIRS, lib_store.STORE_DIRS)
        self.assertEqual(doctor.REQUIRED_CONFIG_KEYS,
                         lib_store.REQUIRED_CONFIG_KEYS)
        self.assertEqual(doctor.FIX_STORE, drift_check.FIX_STORE)

    def test_absent(self):
        self.assertEqual(self.assert_same(), "missing")

    def test_partial(self):
        self.store_tree(dirs=("registry",))
        self.assertEqual(self.assert_same(), "drift")

    def test_config_absent(self):
        self.store_tree(config=None)
        self.assertEqual(self.assert_same(), "drift")

    def test_unreadable_config(self):
        self.store_tree(config="user_name: [a, b]\n")
        self.assertEqual(self.assert_same(), "drift")

    def test_missing_keys(self):
        self.store_tree(config="user_name: tim\nrole: ''\n")
        self.assertEqual(self.assert_same(), "drift")

    def test_complete(self):
        self.store_tree()
        self.assertEqual(self.assert_same(), "ok")


class Sbx(DoctorCase):
    def test_exit_zero_passes_and_only_daemon_status_runs(self):
        check = self.checks(self.doctor(roster=self.full_roster())[0])[
            "sbx-daemon"]
        self.assertEqual(check["status"], "pass")
        sbx = [c for c in self.commands() if c.startswith("sbx")]
        self.assertEqual(sbx, ["sbx daemon status"])

    def test_non_zero_fails_naming_the_safe_start(self):
        self.host.sbx_rc = 1
        check = self.checks(self.doctor(roster=self.full_roster())[0])[
            "sbx-daemon"]
        self.assertEqual(check["status"], "fail")
        self.assertIn("sign-in task", check["fix"])
        self.assertIn("start.ps1", check["fix"])

    def test_missing_sbx_is_skipped(self):
        self.drop_tools("sbx")
        check = self.checks(self.doctor(roster=self.full_roster())[0])[
            "sbx-daemon"]
        self.assertEqual(check["status"], "skipped")
        self.assertNotIn("sbx daemon status", self.commands())


class SandboxLogin(DoctorCase):
    """Story 33.2 (AC2, rulings A and B): the engine sandbox's Max login,
    read through ``sbx exec`` after ``sbx daemon status`` and ``sbx ls``;
    warn from 7 days before ``refreshTokenExpiresAt``, fail once expired."""

    def check(self) -> dict:
        return self.checks(self.doctor(roster=self.full_roster())[0])[
            "sandbox-login"]

    def sbx_commands(self) -> list[str]:
        return [c for c in self.commands() if c.startswith("sbx")]

    def test_skipped_with_no_sandbox_configured_no_sbx_read(self):
        check = self.check()
        self.assertEqual(check["status"], "skipped")
        self.assertIn("TK_SUPERVISOR_CONFIG not set", check["detail"])
        self.assertTrue(check["fix"])
        self.assertEqual(self.sbx_commands(), ["sbx daemon status"])
        # a config naming no sandbox (a host-only box) is skipped too
        path = self.tmp / "supervisor.yaml"
        path.write_text("jobs:\n  p/j:\n    tier: host\n", encoding="utf-8")
        self.env["TK_SUPERVISOR_CONFIG"] = str(path)
        self.host.calls.clear()
        check = self.check()
        self.assertEqual(check["status"], "skipped")
        self.assertIn("names no jobs.*.sandbox", check["detail"])
        self.assertEqual(self.sbx_commands(), ["sbx daemon status"])

    def test_skipped_when_sbx_is_absent_or_the_daemon_is_down(self):
        self.engine_sandbox()
        self.host.sbx_rc = 1
        check = self.check()
        self.assertEqual(check["status"], "skipped")
        self.assertIn("sbx daemon status exit 1", check["detail"])
        self.assertEqual(self.sbx_commands(), ["sbx daemon status"])
        self.drop_tools("sbx")
        self.host.calls.clear()
        check = self.check()
        self.assertEqual(check["status"], "skipped")
        self.assertIn("sbx not on PATH", check["detail"])
        self.assertEqual(self.sbx_commands(), [])

    def test_a_stopped_sandbox_is_skipped_never_execed(self):
        self.engine_sandbox(running=False)
        check = self.check()
        self.assertEqual(check["status"], "skipped")
        self.assertIn("not running", check["detail"])
        self.assertEqual(self.sbx_commands(), ["sbx daemon status", "sbx ls"])

    def test_the_warning_window(self):
        for days, status in ((30, "pass"), (7.05, "pass"), (7, "warn"),
                             (1, "warn"), (0.01, "warn"), (0, "fail"),
                             (-3, "fail")):
            with self.subTest(days=days):
                self.host.calls.clear()
                self.engine_sandbox(days_left=days)
                check = self.check()
                self.assertEqual(check["status"], status, check)
                if status == "pass":
                    self.assertIsNone(check["fix"])
                else:
                    self.assertIn("sbx run --name claude-tk-studio → /login"
                                  " → /exit", check["fix"])
                self.assertIn("claude-tk-studio", check["detail"])
        self.assertIn("expired at", check["detail"])

    def test_reads_only_the_expiry_field_never_a_token(self):
        self.engine_sandbox(days_left=3)
        check = self.check()
        execs = [a for a, _ in self.host.calls if a[1:2] == ["exec"]]
        self.assertEqual(execs[0][2:], ["claude-tk-studio", "env", "-u",
                                        "ANTHROPIC_API_KEY", "claude", "auth",
                                        "status", "--json"])
        self.assertEqual(execs[1][2:5], ["claude-tk-studio", "python3", "-c"])
        script = execs[1][5]
        self.assertIn("refreshTokenExpiresAt", script)
        self.assertNotIn("accessToken", script)
        self.assertNotIn("refreshToken'", script)
        self.assertEqual(len(execs), 2)
        expires = datetime.fromtimestamp(NOW + 3 * DAY, timezone.utc)
        self.assertIn(expires.strftime("%Y-%m-%dT%H:%M:%SZ"), check["detail"])
        self.assertEqual(check["sandboxes"][0]["case"], "expiring")

    def test_logged_out_fails_and_an_unreadable_expiry_warns(self):
        self.engine_sandbox()
        self.host.auth_out = json.dumps({"loggedIn": False})
        check = self.check()
        self.assertEqual(check["status"], "fail")
        self.assertIn("logged out", check["detail"])
        self.assertIn("/login", check["fix"])
        self.host.auth_out = json.dumps({"loggedIn": True})
        self.engine_sandbox(days_left=None)
        check = self.check()
        self.assertEqual(check["status"], "warn")
        self.assertIn("could not be read", check["detail"])

    def test_one_total_budget_a_spent_budget_is_skipped(self):
        """The check's sbx reads share one budget (well below the
        conformance runner's 60 s); a spent budget is skipped like a
        daemon that is down, the detail naming the timeout."""
        self.assertLess(doctor.SANDBOX_LOGIN_BUDGET, 60)
        self.engine_sandbox()
        with mock.patch.object(doctor, "SANDBOX_LOGIN_BUDGET", 0):
            check = self.check()
        self.assertEqual(check["status"], "skipped")
        self.assertIn("budget", check["detail"])
        self.assertIn("timed out at `sbx ls`", check["detail"])
        self.assertTrue(check["fix"])
        self.assertEqual(self.sbx_commands(), ["sbx daemon status"])
        self.host.calls.clear()
        self.host.exec_timeout = True
        check = self.check()
        self.assertEqual(check["status"], "skipped")
        self.assertIn("timed out at `sbx exec claude-tk-studio`",
                      check["detail"])

    def test_a_later_timeout_keeps_an_expired_reading_failing(self):
        """Two sandboxes, the first expired, the second timing out: the
        check still fails on the first, never skipped by the second."""
        path = self.engine_sandbox(days_left=-1)
        path.write_text('jobs:\n  "p/a":\n    tier: sbx\n'
                        '    sandbox: claude-tk-studio\n'
                        '  "p/b":\n    tier: sbx\n'
                        '    sandbox: claude-other\n', encoding="utf-8")
        self.host.sbx_ls += "claude-other   claude  running\n"
        real = self.host.__call__

        def host(args, env=None):
            if [str(a) for a in args][1:3] == ["exec", "claude-other"]:
                self.host.calls.append(([str(a) for a in args], env))
                raise subprocess.TimeoutExpired(args, 20)
            return real(args, env)

        with mock.patch.object(type(self.host), "__call__",
                               lambda _self, args, env=None: host(args, env)):
            check = self.check()
        self.assertEqual(check["status"], "fail", check)
        self.assertIn("claude-tk-studio: the Max login expired at",
                      check["detail"])
        self.assertIn("timed out at `sbx exec claude-other`",
                      check["detail"])
        self.assertEqual([s["case"] for s in check["sandboxes"]],
                         ["expired", "no-sandbox"])

    def test_an_expired_login_names_the_check_in_the_reason(self):
        self.engine_sandbox(days_left=-1)
        result, _ = self.doctor(roster=self.full_roster())
        self.assertIn("sandbox-login", result["reason"])


class FolderTrust(DoctorCase):
    plat = WINDOWS

    def test_one_entry_per_root_matched_by_normalized_path(self):
        self.registry({"a": "C:\\GitHub\\Alpha", "b": "C:\\GitHub\\beta"})
        self.trust({"c:/github/alpha/": True, "C:\\GitHub\\beta": False})
        checks = self.checks(self.doctor(roster=self.full_roster())[0])
        self.assertEqual(checks["folder-trust:a"]["status"], "pass")
        self.assertEqual(checks["folder-trust:b"]["status"], "fail")
        self.assertEqual(checks["folder-trust:b"]["fix"],
                         "open Claude Code in C:\\GitHub\\beta and accept "
                         "the trust dialog")

    def test_a_trusted_ancestor_trusts_a_nested_root(self):
        """Hole 35: a registered root inside a trusted folder passes (Claude
        Code inherits trust into subfolders); a sibling whose name merely
        starts with the trusted folder's does not."""
        self.registry({"sup": "C:\\GitHub\\tk-studio\\apps\\supervisor",
                       "sib": "C:\\GitHub\\tk-studio-supervisor",
                       "far": "D:\\work\\game"})
        self.trust({"C:/GitHub/tk-studio": True, "D:\\work": False})
        checks = self.checks(self.doctor(roster=self.full_roster())[0])
        self.assertEqual(checks["folder-trust:sup"]["status"], "pass",
                         checks["folder-trust:sup"])
        self.assertIn("ancestor c:/github/tk-studio",
                      checks["folder-trust:sup"]["detail"])
        self.assertIsNone(checks["folder-trust:sup"]["fix"])
        self.assertEqual(checks["folder-trust:sib"]["status"], "fail")
        self.assertEqual(checks["folder-trust:far"]["status"], "fail")
        self.assertIn("no trusted ancestor", checks["folder-trust:far"]["detail"])

    def test_colliding_keys_prefer_the_accepted_record(self):
        self.registry({"demo": "C:\\GitHub\\demo"})
        for order in ((("C:/GitHub/demo", True), ("c:\\github\\demo", False)),
                      (("c:\\github\\demo", False), ("C:/GitHub/demo", True))):
            with self.subTest(order=order):
                self.trust(dict(order))
                check = self.checks(self.doctor(
                    roster=self.full_roster())[0])["folder-trust:demo"]
                self.assertEqual(check["status"], "pass", check)

    def test_absent_root_fails(self):
        self.registry({"a": "C:\\GitHub\\Alpha"})
        check = self.checks(self.doctor(roster=self.full_roster())[0])[
            "folder-trust:a"]
        self.assertEqual(check["status"], "fail")

    def test_empty_registry_is_skipped(self):
        self.registry({})
        check = self.checks(self.doctor(roster=self.full_roster())[0])[
            "folder-trust"]
        self.assertEqual(check["status"], "skipped")
        self.assertTrue(check["fix"])

    def test_unreadable_registry_or_state_fails_naming_the_path(self):
        path = self.registry({"a": "C:\\x"})
        path.write_text("projects: [a, b]\n")
        check = self.checks(self.doctor(roster=self.full_roster())[0])[
            "folder-trust"]
        self.assertEqual(check["status"], "fail")
        self.assertIn(str(path), check["detail"])
        self.registry({"a": "C:\\x"})
        (self.config / ".claude.json").write_text("{broken")
        check = self.checks(self.doctor(roster=self.full_roster())[0])[
            "folder-trust"]
        self.assertEqual(check["status"], "fail")
        self.assertIn(str(self.config / ".claude.json"), check["detail"])


class LongPaths(DoctorCase):
    def test_off_windows_is_skipped(self):
        check = self.checks(self.doctor(roster=self.full_roster())[0])[
            "long-paths"]
        self.assertEqual((check["status"], check["detail"]),
                         ("skipped", "windows only"))
        self.assertNotIn("git", " ".join(self.commands()))


class LongPathsWindows(DoctorCase):
    plat = WINDOWS

    def test_both_on_passes(self):
        check = self.checks(self.doctor(roster=self.full_roster())[0])[
            "long-paths"]
        self.assertEqual(check["status"], "pass")

    def test_either_off_fails_naming_it(self):
        self.hklm_value = None
        check = self.checks(self.doctor(roster=self.full_roster())[0])[
            "long-paths"]
        self.assertEqual(check["status"], "fail")
        self.assertIn("LongPathsEnabled", check["fix"])
        self.hklm_value = 1
        self.host.longpaths = "false"
        check = self.checks(self.doctor(roster=self.full_roster())[0])[
            "long-paths"]
        self.assertEqual(check["status"], "fail")
        self.assertIn("core.longpaths true", check["fix"])

    def test_git_boolean_true_spellings_pass(self):
        for word in ("yes", "1", "On", "TRUE"):
            with self.subTest(word=word):
                self.host.longpaths = word
                check = self.checks(self.doctor(
                    roster=self.full_roster())[0])["long-paths"]
                self.assertEqual(check["status"], "pass", check)

    def test_missing_git_is_skipped(self):
        self.drop_tools("git")
        check = self.checks(self.doctor(roster=self.full_roster())[0])[
            "long-paths"]
        self.assertEqual(check["status"], "skipped")


class PathLauncher(DoctorCase):
    plat = WINDOWS

    def test_launcher_on_the_hkcu_path_passes(self):
        bin_dir = self.root / "bin"
        bin_dir.mkdir(parents=True)
        (bin_dir / "tk-studio.exe").write_text("cli")
        self.store.values["Path"] = f"C:\\Windows;{bin_dir}\\"
        check = self.checks(self.doctor(roster=self.full_roster())[0])[
            "path-launcher"]
        self.assertEqual(check["status"], "pass")
        self.assertIn("HKCU Path", check["detail"])

    def test_an_unexpanded_hkcu_entry_passes(self):
        # the HKCU Path is read raw (REG_EXPAND_SZ): the bootstrap keeps a
        # %LOCALAPPDATA% entry unexpanded, and doctor expands it from env
        bin_dir = self.root / "bin"
        bin_dir.mkdir(parents=True)
        (bin_dir / "tk-studio.exe").write_text("cli")
        self.env["LOCALAPPDATA"] = str(self.tmp / "local")
        self.assertNotIn(str(bin_dir), self.env["PATH"])
        for ref in ("%LOCALAPPDATA%", "%LocalAppData%"):   # names fold case
            with self.subTest(ref=ref):
                self.store.values["Path"] = (f"C:\\Windows;{ref}"
                                             "\\tk-studio\\bin")
                check = self.checks(self.doctor(
                    roster=self.full_roster())[0])["path-launcher"]
                self.assertEqual(check["status"], "pass", check)
                self.assertIn("HKCU Path", check["detail"])
                self.assertNotIn("process PATH", check["detail"])

    def test_an_unknown_reference_stays_unexpanded(self):
        bin_dir = self.root / "bin"
        bin_dir.mkdir(parents=True)
        (bin_dir / "tk-studio.exe").write_text("cli")
        self.store.values["Path"] = "%NOSUCHVAR%\\tk-studio\\bin"
        check = self.checks(self.doctor(roster=self.full_roster())[0])[
            "path-launcher"]
        self.assertEqual(check["status"], "fail", check)

    def test_missing_launcher_or_path_fails(self):
        check = self.checks(self.doctor(roster=self.full_roster())[0])[
            "path-launcher"]
        self.assertEqual(check["status"], "fail")
        self.assertIn("bootstrap", check["fix"])


class TailscaleCert(DoctorCase):
    def test_unset_is_skipped(self):
        check = self.checks(self.doctor(roster=self.full_roster())[0])[
            "tailscale-cert"]
        self.assertEqual(check["status"], "skipped")

    def test_missing_file_fails(self):
        self.env["TK_SUPERVISOR_TLS_CERT"] = str(self.tmp / "absent.crt")
        check = self.checks(self.doctor(roster=self.full_roster())[0])[
            "tailscale-cert"]
        self.assertEqual(check["status"], "fail")

    def test_age_against_ninety_days(self):
        for age, status in ((89, "pass"), (90, "fail"), (200, "fail")):
            with self.subTest(age=age):
                self.env["TK_SUPERVISOR_TLS_CERT"] = str(self.cert(age))
                check = self.checks(self.doctor(
                    roster=self.full_roster())[0])["tailscale-cert"]
                self.assertEqual(check["status"], status, check)
                self.assertIn("file mtime", check["detail"])
                if status == "fail":
                    self.assertIn("tailscale cert", check["fix"])


# a self-signed EC certificate (openssl req -x509, CN box.ts.net, 365 days):
# notBefore Oct 15 00:11:40 2026 GMT, notAfter Oct 15 00:11:40 2027 GMT
PEM = """-----BEGIN CERTIFICATE-----
MIIBfzCCASWgAwIBAgIUSem6Py8W2VoO5xXpeLpFIIjNzvYwCgYIKoZIzj0EAwIw
FTETMBEGA1UEAwwKYm94LnRzLm5ldDAeFw0yNjEwMTUwMDExNDBaFw0yNzEwMTUw
MDExNDBaMBUxEzARBgNVBAMMCmJveC50cy5uZXQwWTATBgcqhkjOPQIBBggqhkjO
PQMBBwNCAAQdNAFgkfROy6Ie7Cr6+GZ9NtUisM9X99PoY5MGkSV9cbgKCt7a/ndR
IcjogZqW18HRrumXU37Suoky8iQo2Vv/o1MwUTAdBgNVHQ4EFgQURqVagXQ48axN
g8vQheQe5SweCU4wHwYDVR0jBBgwFoAURqVagXQ48axNg8vQheQe5SweCU4wDwYD
VR0TAQH/BAUwAwEB/zAKBggqhkjOPQQDAgNIADBFAiBAC6ZM6MfBSC8ic4uXaOQX
aieP0WRpPut/XDD6a5g0MAIhAN+tXX6XImrqcNV2NVnpcF8FJArDwoL4YP6iY8hk
RedN
-----END CERTIFICATE-----
"""
PEM_NOT_BEFORE = 1_792_023_100.0
PEM_NOT_AFTER = 1_823_559_100.0


@unittest.skipUnless(getattr(getattr(ssl, "_ssl", None),
                             "_test_decode_cert", None),
                     "no ssl._ssl._test_decode_cert: the mtime fallback "
                     "stands in (TailscaleCert covers it)")
class TailscaleCertPem(DoctorCase):
    def cert_check(self, now: float) -> dict:
        path = self.tmp / "tls" / "box.ts.net.crt"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(PEM)
        # an mtime that contradicts every case: the certificate must win
        os.utime(path, (now - 45 * DAY if now - PEM_NOT_BEFORE >= 90 * DAY
                        else now - 200 * DAY,) * 2)
        self.env["TK_SUPERVISOR_TLS_CERT"] = str(path)
        return self.checks(self.doctor(roster=self.full_roster(),
                                       now=lambda: now)[0])["tailscale-cert"]

    def test_young_by_not_before_passes(self):
        check = self.cert_check(PEM_NOT_BEFORE + 30 * DAY)
        self.assertEqual(check["status"], "pass", check)
        self.assertIn("30 days old (from its notBefore)", check["detail"])
        self.assertNotIn("file mtime", check["detail"])

    def test_ninety_days_by_not_before_fails(self):
        for age in (90, 100):
            with self.subTest(age=age):
                check = self.cert_check(PEM_NOT_BEFORE + age * DAY)
                self.assertEqual(check["status"], "fail", check)
                self.assertIn(f"{age} days old (from its notBefore)",
                              check["detail"])
                self.assertNotIn("expired", check["detail"])
                self.assertIn("tailscale cert", check["fix"])

    def test_past_not_after_fails_expired(self):
        check = self.cert_check(PEM_NOT_AFTER + DAY)
        self.assertEqual(check["status"], "fail", check)
        self.assertIn("from its notBefore", check["detail"])
        self.assertTrue(check["detail"].endswith("; expired"), check)
        self.assertIn("tailscale cert", check["fix"])


class Supervisor(DoctorCase):
    def test_not_shipped_is_skipped(self):
        # Derived from the committed roster (25.1 ruling: the component set is
        # evidence, not an invariant): an absent component is skipped as "not
        # shipped"; a present one is judged (and fails here, nothing is
        # installed in the isolated data dir).
        committed = json.loads(
            (ROSTERS / "latest.json").read_text(encoding="utf-8"))
        checks = self.checks(self.doctor(roster=ROSTERS / "latest.json")[0])
        for name in ("supervisor", "studio-web"):
            if committed["components"].get(name) is None:
                self.assertEqual(
                    (checks[name]["status"], checks[name]["detail"]),
                    ("skipped", "not shipped in latest"), name)
            else:
                self.assertNotEqual(checks[name]["status"], "skipped", name)

    def test_not_installed_fails_with_install(self):
        checks = self.checks(self.doctor(roster=self.full_roster())[0])
        self.assertEqual(checks["supervisor"]["fix"], "run tk-studio install")
        self.assertEqual(checks["studio-web"]["fix"], "run tk-studio install")
        self.assertEqual(self.host.probes, [], "nothing to probe")

    def test_slot_answers_or_not(self):
        roster = self.full_roster()
        self.run_cli(["install", "--roster", str(roster)])
        check = self.checks(self.doctor(roster=roster)[0])["supervisor"]
        self.assertEqual(check["status"], "pass")
        self.assertIn("slot 0.1.0", check["detail"])
        self.host.up = False
        check = self.checks(self.doctor(roster=roster)[0])["supervisor"]
        self.assertEqual(check["status"], "fail")
        self.assertIn("Startup shortcut", check["fix"])

    def test_dw12_studio_web_path_gone(self):
        roster = self.full_roster()
        self.run_cli(["install", "--roster", str(roster)])
        web = self.root / "studio-web" / "0.1.0"
        current = json.loads((self.root / "current.json").read_text())
        current["studio-web"]["path"] = str(self.root / "studio-web" / "9.9")
        (self.root / "current.json").write_text(json.dumps(current))
        check = self.checks(self.doctor(roster=roster)[0])["studio-web"]
        self.assertEqual(check["status"], "fail")
        self.assertIn("does not exist (DW-12)", check["detail"])
        self.assertEqual(check["fix"].split(" (")[0], "run tk-studio update")
        self.assertTrue(web.is_dir())

    def test_cli_helper_is_reported_never_deleted(self):
        tools = self.root / "tools"
        tools.mkdir(parents=True)
        (tools / "cli-update.cmd").write_text("rem\n")
        check = self.checks(self.doctor(roster=self.full_roster())[0])[
            "cli-update-helper"]
        self.assertEqual(check["status"], "warn")
        self.assertTrue((tools / "cli-update.cmd").is_file())


def stamp(seconds: float) -> str:
    """A log line's ISO UTC stamp (apps/supervisor/src/log.ts formatLine)."""
    return datetime.fromtimestamp(seconds, timezone.utc).strftime(
        "%Y-%m-%dT%H:%M:%S.000Z")


class SupervisorLog(DoctorCase):
    """Story 33.1 (AC2): the newest log's last `stopped` or `uncaught` line
    and its age when the API does not answer; read-only."""

    def check(self, **kw) -> dict:
        return self.checks(self.doctor(roster=self.full_roster(), **kw)[0])[
            "supervisor-log"]

    def test_work_unset_is_skipped(self):
        self.env.pop("TK_SUPERVISOR_WORK", None)
        check = self.check()
        self.assertEqual(check["status"], "skipped", check)
        self.assertIn("TK_SUPERVISOR_WORK not set", check["detail"])
        self.assertTrue(check["fix"])

    def test_no_folder_warns_no_log(self):
        self.env["TK_SUPERVISOR_WORK"] = str(self.tmp / "work")
        check = self.check()
        self.assertEqual(check["status"], "warn", check)
        self.assertTrue(check["detail"].startswith("no log"), check)
        self.assertIn(str(self.tmp / "work" / "supervisor" / "logs"),
                      check["fix"])
        self.assertIn("start.ps1", check["fix"])
        # a folder holding no day file is no log either
        (self.tmp / "work" / "supervisor" / "logs").mkdir(parents=True)
        (self.tmp / "work" / "supervisor" / "logs" / "notes.txt").write_text(
            "x\n")
        self.assertTrue(self.check()["detail"].startswith("no log"))

    def test_api_answers_passes_naming_the_file_and_the_age(self):
        self.run_cli(["install", "--roster", str(self.full_roster())])
        self.supervisor_log([f"{stamp(NOW - 900)} [keeper] stopped (exit 75)",
                             f"{stamp(NOW - 30)} [serve] listening"],
                            day="2033-05-17")
        newest = self.supervisor_log(
            [f"{stamp(NOW - 300)} [pacer] started"])
        check = self.check()
        self.assertEqual(check["status"], "pass", check)
        self.assertIn(str(newest), check["detail"])
        self.assertIn("no stopped/uncaught line", check["detail"])
        self.supervisor_log([f"{stamp(NOW - 300)} [tick] uncaught: boom",
                             f"{stamp(NOW - 200)} [pacer] started"])
        check = self.check()
        self.assertEqual(check["status"], "pass", check)
        self.assertEqual(check["detail"],
                         f"{newest}; last uncaught line 5m ago")
        self.assertIsNone(check["fix"])

    def test_api_down_warns_with_the_line_verbatim_its_age_and_the_start(self):
        self.run_cli(["install", "--roster", str(self.full_roster())])
        self.host.calls.clear()
        self.host.up = False
        line = f"{stamp(NOW - 2 * 3600)} [keeper] stopped (exit 1)"
        path = self.supervisor_log([
            f"{stamp(NOW - 3 * 3600)} [pacer] started", line,
            f"{stamp(NOW - 3600)} [tick] a later line"])
        os.utime(path, (NOW - 3600, NOW - 3600))
        before = (path.stat().st_mtime, path.read_bytes())
        check = self.check()
        self.assertEqual(check["status"], "warn", check)
        self.assertEqual(check["detail"], f"{path}: {line} (2h ago)")
        self.assertEqual(check["fix"], doctor.FIX_START)
        self.assertEqual((path.stat().st_mtime, path.read_bytes()), before,
                         "the log is read, never written")
        self.assertTrue(set(self.commands()) <= ALLOWED, self.commands())

    def test_api_down_redacts_a_credential_in_the_line(self):
        self.run_cli(["install", "--roster", str(self.full_roster())])
        self.host.up = False
        path = self.supervisor_log(
            [f"{stamp(NOW - 600)} [pacer] stopped (Bearer abc123)"])
        check = self.check()
        self.assertEqual(check["status"], "warn", check)
        self.assertIn("[redacted]", check["detail"])
        self.assertNotIn("abc123", check["detail"])
        self.assertIn(str(path), check["detail"])

    def test_the_check_follows_the_supervisor_group(self):
        names = [c["check"] for c in self.doctor(
            roster=self.full_roster())[0]["checks"]]
        self.assertLess(names.index("supervisor"),
                        names.index("supervisor-log"))
        self.assertEqual(_age_cases(), ["59s", "1m", "2h", "3d"])


def _age_cases() -> list[str]:
    return [doctor._age(s) for s in (59, 60, 2 * 3600 + 5, 3 * DAY + 1)]


class SupervisorCheckout(DoctorCase):
    """The matrix row's other half: a source checkout named by the Startup
    shortcut (a process-free ``.lnk`` read), probed like a slot."""
    plat = WINDOWS

    def setUp(self):
        super().setUp()
        self.co = self.tmp / "GitHub" / "tk-studio-supervisor"
        (self.co / ".git").mkdir(parents=True)
        lnk = (self.tmp / "roaming" / "Microsoft" / "Windows" / "Start Menu"
               / "Programs" / "Startup" / "tk-studio supervisor.lnk")
        lnk.parent.mkdir(parents=True)
        lnk.write_bytes(lnk_bytes(str(self.co)))

    def test_checkout_answers_passes_naming_it(self):
        self.host.up = True
        result = self.doctor(roster=self.full_roster())[0]
        self.assertEqual(result["supervisor"]["mode"], "source checkout")
        check = self.checks(result)["supervisor"]
        self.assertEqual(check["status"], "pass", check)
        self.assertIn(f"source checkout {self.co}", check["detail"])
        self.assertIsNone(check["fix"])

    def test_checkout_no_answer_fails_with_the_startup_shortcut(self):
        check = self.checks(self.doctor(roster=self.full_roster())[0])[
            "supervisor"]
        self.assertEqual(check["status"], "fail", check)
        self.assertIn(f"source checkout {self.co}", check["detail"])
        self.assertIn("does not answer", check["detail"])
        self.assertIn("Startup shortcut", check["fix"])
        self.assertEqual(len(self.host.probes), 1)


CUT_OVER = ("supervisor-root", "supervisor-registry", "supervisor-trust",
            "startup-shortcut")


class CutOver(DoctorCase):
    """Story 28.4: the cut-over on the box — the nested root, its registry
    agreement, its own folder trust and the Startup shortcut's target, each
    read without a process (the ``.lnk`` is parsed, ``.git`` is walked)."""
    plat = WINDOWS

    def setUp(self):
        super().setUp()
        self.outer = self.tmp / "GitHub" / "tk-studio"
        (self.outer / ".git").mkdir(parents=True)
        (self.outer / ".tk-studio").mkdir()
        (self.outer / ".tk-studio" / "config.yaml").write_text("schema: 1\n")
        self.nested = self.outer / "apps" / "supervisor"
        (self.nested / ".tk-studio").mkdir(parents=True)
        (self.nested / ".tk-studio" / "config.yaml").write_text(
            "project_id: supervisor\n")
        (self.nested / "start.ps1").write_text("# start\n")
        self.lnk = (self.tmp / "roaming" / "Microsoft" / "Windows"
                    / "Start Menu" / "Programs" / "Startup"
                    / "tk-studio supervisor.lnk")
        self.lnk.parent.mkdir(parents=True)
        self.shortcut(self.nested)

    def shortcut(self, workdir: Path, target: str | None = None,
                 arguments: str | None = None):
        if arguments is None:
            target = target or str(workdir / "start.ps1")
            arguments = ("-w studio nt --title supervisor pwsh -NoExit "
                         f"-File {target}")
        self.lnk.write_bytes(lnk_bytes(str(workdir), arguments=arguments))

    def healthy(self):
        self.registry({"supervisor": str(self.nested)})
        self.trust({str(self.nested): True})

    def cut_over(self, roster: Path | None = None) -> dict[str, dict]:
        result = self.doctor(roster=roster or self.full_roster())[0]
        self.result = result
        return {k: v for k, v in self.checks(result).items()
                if k in CUT_OVER}

    def test_healthy_cut_over_passes_each_naming_its_path(self):
        self.healthy()
        roster = self.full_roster()
        before = self.snapshot()
        self.host.calls.clear()
        checks = self.cut_over(roster)
        cut_over_calls = list(self.host.calls)
        self.assertEqual(list(checks), list(CUT_OVER))
        for name in CUT_OVER:
            with self.subTest(check=name):
                self.assertEqual(checks[name]["status"], "pass",
                                 checks[name])
                self.assertIsNone(checks[name]["fix"])
        self.assertEqual(self.result["supervisor"]["mode"], "source checkout")
        self.assertEqual(self.result["supervisor"]["checkout"],
                         str(self.nested))
        self.assertIn(str(self.nested), checks["supervisor-root"]["detail"])
        self.assertIn(str(self.outer), checks["supervisor-root"]["detail"])
        self.assertIn(str(self.nested),
                      checks["supervisor-registry"]["detail"])
        self.assertIn(str(self.nested), checks["supervisor-trust"]["detail"])
        self.assertIn(str(self.nested / "start.ps1"),
                      checks["startup-shortcut"]["detail"])
        self.assertTrue(set(self.commands()) <= ALLOWED, self.commands())
        self.assertEqual(self.snapshot(), before, "doctor is read-only")
        names = [c["check"] for c in self.result["checks"]]
        at = names.index("supervisor")
        self.assertEqual(names[at + 1:at + 5], list(CUT_OVER))
        self.lnk.unlink()                 # the same box, no cut-over to read
        self.host.calls.clear()
        self.cut_over(roster)
        self.assertEqual(cut_over_calls, self.host.calls,
                         "the cut-over checks add no process call")

    def test_quoted_target_passes(self):
        self.healthy()
        self.shortcut(self.nested, arguments=(
            f'-w studio nt -d "{self.nested}" --title supervisor pwsh '
            f'-NoExit -File "{self.nested / "start.ps1"}"'))
        self.assertEqual(self.cut_over()["startup-shortcut"]["status"],
                         "pass")

    def test_old_layout_fails_naming_its_own_repository(self):
        old = self.tmp / "GitHub" / "tk-studio-supervisor"
        (old / ".git").mkdir(parents=True)
        (old / "start.ps1").write_text("# old\n")
        self.shortcut(old)
        self.healthy()
        checks = self.cut_over()
        root = checks["supervisor-root"]
        self.assertEqual(root["status"], "fail", root)
        self.assertIn("repository of its own", root["detail"])
        self.assertIn("pre-cut-over", root["detail"])
        self.assertIn("§4.3", root["fix"])
        self.assertEqual(checks["startup-shortcut"]["status"], "pass")
        # registry and trust would judge the old clone: not checked
        for name in ("supervisor-registry", "supervisor-trust"):
            with self.subTest(check=name):
                self.assertEqual(
                    (checks[name]["status"], checks[name]["detail"]),
                    ("skipped", "not checked: supervisor-root failed"))
                self.assertEqual(checks[name]["fix"], "retarget the shortcut "
                                 "first (supervisor-root's fix)")
                self.assertNotIn(str(old), checks[name]["fix"])

    def test_old_onboarded_clone_fails_naming_its_own_repository(self):
        # the real old clone was onboarded: it holds its own studio config
        old = self.tmp / "GitHub" / "tk-studio-supervisor"
        (old / ".git").mkdir(parents=True)
        (old / ".tk-studio").mkdir()
        (old / ".tk-studio" / "config.yaml").write_text(
            "project_id: supervisor\n")
        (old / "start.ps1").write_text("# old\n")
        self.shortcut(old)
        self.healthy()
        checks = self.cut_over()
        root = checks["supervisor-root"]
        self.assertEqual(root["status"], "fail", root)
        self.assertIn("repository of its own", root["detail"])
        self.assertIn("pre-cut-over", root["detail"])
        self.assertNotIn("repository top level", root["detail"])
        self.assertIn("§4.3", root["fix"])
        for name in ("supervisor-registry", "supervisor-trust"):
            with self.subTest(check=name):
                self.assertEqual(
                    (checks[name]["status"], checks[name]["detail"]),
                    ("skipped", "not checked: supervisor-root failed"))
                self.assertNotIn(str(old), checks[name]["fix"])

    def test_the_repository_top_level_is_not_the_nested_root(self):
        self.shortcut(self.outer, target=str(self.nested / "start.ps1"))
        self.healthy()
        checks = self.cut_over()
        root = checks["supervisor-root"]
        self.assertEqual(root["status"], "fail", root)
        self.assertIn("repository top level", root["detail"])
        self.assertNotIn("pre-cut-over", root["detail"])
        self.assertIn("§4.3", root["fix"])
        self.assertEqual(checks["supervisor-registry"]["status"], "skipped")

    def test_a_checkout_subfolder_without_studio_config_is_no_root(self):
        plain = self.outer / "plugins"
        plain.mkdir()
        (plain / "start.ps1").write_text("#\n")
        check = doctor.check_supervisor_root(None, str(plain))
        self.assertEqual(check["status"], "fail", check)
        self.assertIn(str(plain), check["detail"])
        self.assertIn("no .tk-studio/config.yaml", check["detail"])
        self.assertIn("§4.3", check["fix"])
        # through doctor it is no source checkout at all: the supervisor
        # check names it, and the root checks are absent
        self.healthy()
        self.shortcut(plain)
        checks = self.cut_over()
        self.assertEqual(list(checks), ["startup-shortcut"])
        self.assertEqual(self.result["supervisor"]["mode"], "not installed")
        self.assertEqual(self.checks(self.result)["supervisor"]["status"],
                         "fail")

    def test_a_nested_root_without_start_ps1_names_it(self):
        self.healthy()
        (self.nested / "start.ps1").unlink()
        root = self.cut_over()["supervisor-root"]
        self.assertEqual(root["status"], "fail", root)
        self.assertIn("holds no start.ps1", root["detail"])
        self.assertIn("restore apps/supervisor/start.ps1", root["fix"])

    def test_registry_agreement_folds_case_and_slash(self):
        self.registry({"supervisor": str(self.nested).upper()
                       .replace("/", "\\") + "\\"})
        self.trust({str(self.nested): True})
        check = self.cut_over()["supervisor-registry"]
        self.assertEqual(check["status"], "pass", check)

    def test_registry_root_differs_fails_naming_both(self):
        other = "C:\\GitHub\\tk-studio-supervisor"
        self.registry({"supervisor": other})
        self.trust({str(self.nested): True})
        check = self.cut_over()["supervisor-registry"]
        self.assertEqual(check["status"], "fail")
        self.assertIn(other, check["detail"])
        self.assertIn(str(self.nested), check["detail"])
        self.assertIn("registry.py amend --project-id supervisor --writer "
                      f"activate --root {self.nested}", check["fix"])
        self.assertIn("doctor never edits", check["fix"])

    def test_registry_entry_missing_fails(self):
        for projects in ({"demo": str(self.tmp / "demo")}, None):
            with self.subTest(projects=projects):
                if projects is None:
                    (Path(self.env["TK_STUDIO_HOME"]) / "registry"
                     / "projects.yaml").unlink()
                else:
                    self.registry(projects)
                check = self.cut_over()["supervisor-registry"]
                self.assertEqual(check["status"], "fail")
                self.assertIn("supervisor", check["detail"])
                self.assertIn(str(self.nested), check["detail"])
                self.assertIn("--project-id supervisor", check["fix"])

    def test_project_id_defaults_to_the_basename(self):
        (self.nested / ".tk-studio" / "config.yaml").write_text("schema: 1\n")
        self.registry({"supervisor": str(self.nested)})
        self.trust({str(self.nested): True})
        self.assertEqual(self.cut_over()["supervisor-registry"]["status"],
                         "pass")

    def test_parent_trusted_passes_through_inheritance(self):
        """Hole 35: Claude Code inherits trust into subfolders (2.1.292 on
        the box, 2026-10-17): the nested root is trusted through the
        checkout above it, with no record of its own."""
        self.registry({"supervisor": str(self.nested)})
        self.trust({str(self.outer): True})
        check = self.cut_over()["supervisor-trust"]
        self.assertEqual(check["status"], "pass", check)
        self.assertIn("ancestor", check["detail"])
        self.assertIn("§4.1", check["detail"])
        self.assertIn(str(self.nested), check["detail"])
        self.assertIsNone(check["fix"])

    def test_nothing_trusted_fails_naming_both_ways_to_trust(self):
        self.registry({"supervisor": str(self.nested)})
        self.trust({str(self.tmp / "elsewhere"): True,
                    str(self.outer): False})
        check = self.cut_over()["supervisor-trust"]
        self.assertEqual(check["status"], "fail")
        self.assertIn("neither it nor an ancestor", check["detail"])
        self.assertIn(f"open `claude` in {self.nested}", check["fix"])
        self.assertIn("checkout above it", check["fix"])

    def test_bad_target_fails_naming_what_the_lnk_holds(self):
        self.healthy()
        elsewhere = self.tmp / "elsewhere"
        elsewhere.mkdir()
        (elsewhere / "start.ps1").write_text("#\n")
        for label, kw, needle in (
                ("no -File", {"arguments": "-w studio nt pwsh -NoExit"},
                 "no `-File"),
                ("not start.ps1", {"target": str(self.nested / "run.ps1")},
                 "no `-File"),
                ("other folder", {"target": str(elsewhere / "start.ps1")},
                 "outside its working directory"),
                ("missing", {"target": None}, "does not exist")):
            with self.subTest(case=label):
                if label == "missing":
                    (self.nested / "start.ps1").unlink()
                self.shortcut(self.nested, **kw)
                check = self.cut_over()["startup-shortcut"]
                self.assertEqual(check["status"], "fail", check)
                self.assertIn(needle, check["detail"])
                self.assertIn(str(self.lnk), check["detail"])
                self.assertIn("§4.3", check["fix"])

    def test_unquoted_target_with_a_space_fails_asking_for_quotes(self):
        self.healthy()
        spaced = self.tmp / "My Dir"
        spaced.mkdir()
        (spaced / "start.ps1").write_text("#\n")
        self.shortcut(spaced)                 # -File <tmp>/My Dir/start.ps1
        check = self.cut_over()["startup-shortcut"]
        self.assertEqual(check["status"], "fail", check)
        self.assertIn("must be quoted", check["detail"])
        self.assertIn(str(spaced / "start.ps1"), check["detail"])
        self.assertTrue(check["fix"])

    def test_no_shortcut_fails_and_root_checks_are_absent(self):
        self.healthy()
        for label in ("absent", "unreadable", "APPDATA unset"):
            with self.subTest(case=label):
                if label == "absent":
                    self.lnk.unlink()
                elif label == "unreadable":
                    self.lnk.write_bytes(b"not a link")
                else:
                    del self.env["APPDATA"]
                checks = self.cut_over()
                self.assertEqual(list(checks), ["startup-shortcut"])
                check = checks["startup-shortcut"]
                self.assertEqual(check["status"], "fail")
                self.assertIn("§4.3", check["fix"])
                self.assertIn("APPDATA" if label == "APPDATA unset"
                              else str(self.lnk), check["detail"])

    def test_relative_target_resolves_against_the_working_directory(self):
        self.healthy()
        for arg in ("start.ps1", ".\\start.ps1", "./start.ps1"):
            with self.subTest(arg=arg):
                self.shortcut(self.nested, target=arg)
                check = self.cut_over()["startup-shortcut"]
                self.assertEqual(check["status"], "pass", check)
                self.assertIn(str(self.nested / "start.ps1"),
                              check["detail"])
        self.lnk.write_bytes(lnk_bytes("", arguments=(
            "-w studio nt --title supervisor pwsh -NoExit -File start.ps1")))
        check = self.cut_over()["startup-shortcut"]
        self.assertEqual(check["status"], "fail", check)
        self.assertIn("no absolute working directory", check["detail"])
        self.assertIn("§4.3", check["fix"])

    def test_no_supervisor_shipped_skips_the_shortcut(self):
        self.lnk.unlink()
        roster = self.roster(uv=self.uv())
        checks = self.checks(self.doctor(roster=roster)[0])
        self.assertEqual(checks["supervisor"]["status"], "skipped")
        check = checks["startup-shortcut"]
        self.assertEqual((check["status"], check["detail"]),
                         ("skipped", "not shipped in stable"))
        self.assertTrue(check["fix"])
        self.assertNotIn("startup-shortcut", self.doctor(
            roster=roster)[0]["reason"] or "")

    def test_the_shortcut_fix_follows_the_supervisor_mode(self):
        self.healthy()
        target = "C:\\GitHub\\tk-studio\\apps\\supervisor\\start.ps1"
        self.shortcut(self.nested, arguments="pwsh -NoExit")
        fix = self.cut_over()["startup-shortcut"]["fix"]
        self.assertIn(target, fix)
        self.assertNotIn("tk-studio update", fix)
        slot = self.root / "supervisor" / "0.1.0"
        slot.mkdir(parents=True)
        (self.root / "current.json").write_text(json.dumps({
            "supervisor": {"version": "0.1.0", "path": str(slot)}}))
        self.shortcut(slot, arguments="pwsh -NoExit")
        fix = self.cut_over()["startup-shortcut"]["fix"]
        self.assertIn("`tk-studio update` rewrites the shortcut", fix)
        self.assertIn(str(slot / "start.ps1"), fix)
        self.assertNotIn(target, fix)
        (self.root / "current.json").unlink()
        self.lnk.unlink()
        fix = self.cut_over()["startup-shortcut"]["fix"]
        self.assertIn(target, fix)
        self.assertIn("tk-studio update", fix)

    def test_slot_box_passes_and_stays_a_slot(self):
        slot = self.root / "supervisor" / "0.1.0"
        slot.mkdir(parents=True)
        (slot / "start.ps1").write_text("# slot\n")
        (self.root / "current.json").write_text(json.dumps({
            "supervisor": {"version": "0.1.0", "path": str(slot)}}))
        self.shortcut(slot)
        checks = self.cut_over()
        self.assertEqual(list(checks), ["startup-shortcut"])
        self.assertEqual(checks["startup-shortcut"]["status"], "pass")
        self.assertEqual(self.result["supervisor"]["mode"], "slot")

    def test_a_stale_slot_fails_naming_the_current_slot(self):
        current = self.root / "supervisor" / "0.1.0"
        stale = self.root / "supervisor" / "0.0.9"
        for slot in (current, stale):
            slot.mkdir(parents=True)
            (slot / "start.ps1").write_text("# slot\n")
        (self.root / "current.json").write_text(json.dumps({
            "supervisor": {"version": "0.1.0", "path": str(current)}}))
        self.shortcut(stale)
        check = self.cut_over()["startup-shortcut"]
        self.assertEqual(check["status"], "fail", check)
        self.assertIn(str(stale / "start.ps1"), check["detail"])
        self.assertIn(f"the current slot is {current}", check["detail"])
        self.assertIn(str(current / "start.ps1"), check["fix"])
        self.assertEqual(self.result["supervisor"]["mode"], "slot")

    def test_a_loose_folder_with_start_ps1_fails(self):
        loose = self.tmp / "loose"
        loose.mkdir()
        (loose / "start.ps1").write_text("#\n")
        self.shortcut(loose)
        checks = self.cut_over()
        self.assertEqual(list(checks), ["startup-shortcut"])
        check = checks["startup-shortcut"]
        self.assertEqual(check["status"], "fail", check)
        self.assertIn(str(loose / "start.ps1"), check["detail"])
        self.assertIn("no current slot is installed", check["detail"])
        self.assertTrue(check["fix"])


class CutOverOffWindows(DoctorCase):
    def test_the_cut_over_checks_are_absent(self):
        names = set(self.checks(self.doctor(roster=self.full_roster())[0]))
        self.assertFalse(names & set(CUT_OVER), names)


class Hermes(DoctorCase):
    plat = WINDOWS

    def hermes(self, text: str | None) -> Path:
        home = self.tmp / "local" / "hermes"
        home.mkdir(parents=True, exist_ok=True)
        if text is not None:
            (home / "config.yaml").write_text(text)
        return home / "config.yaml"

    def test_no_hermes_home_is_not_reported(self):
        self.assertNotIn("hermes-logins", self.checks(
            self.doctor(roster=self.full_roster())[0]))

    def test_off_or_absent_passes(self):
        for text in (None, "auth:\n  adopt_external_logins: false\n",
                     "model: x\n"):
            with self.subTest(text=text):
                self.hermes(text)
                check = self.checks(self.doctor(
                    roster=self.full_roster())[0])["hermes-logins"]
                self.assertEqual(check["status"], "pass")

    def test_on_warns_naming_the_setting_and_the_fix(self):
        self.hermes("auth:\n  adopt_external_logins: true\n")
        check = self.checks(self.doctor(roster=self.full_roster())[0])[
            "hermes-logins"]
        self.assertEqual(check["status"], "warn")
        self.assertIn("auth.adopt_external_logins", check["detail"])
        self.assertIn("hermes gateway restart", check["fix"])

    def test_yaml_1_1_spellings_read_as_pyyaml_does(self):
        for word, status in (("True", "warn"), ("yes", "warn"),
                             ("on", "warn"), ("off", "pass")):
            with self.subTest(word=word):
                self.hermes(f"auth:\n  adopt_external_logins: {word}\n")
                check = self.checks(self.doctor(
                    roster=self.full_roster())[0])["hermes-logins"]
                self.assertEqual(check["status"], status, check)
                if status == "warn":
                    self.assertIn("hermes gateway restart", check["fix"])

    def test_only_pyyaml_exact_spellings_are_bools(self):
        # PyYAML's resolver: Off/OFF are false, On is true; n, y and odd
        # case (nO, oFF) stay truthy strings, so they are not clearly off
        for word, status in (("n", "warn"), ("nO", "warn"), ("y", "warn"),
                             ("oFF", "warn"), ("Off", "pass"),
                             ("OFF", "pass"), ("On", "warn")):
            with self.subTest(word=word):
                self.hermes(f"auth:\n  adopt_external_logins: {word}\n")
                check = self.checks(self.doctor(
                    roster=self.full_roster())[0])["hermes-logins"]
                self.assertEqual(check["status"], status, check)
                if word in ("n", "nO", "y", "oFF"):
                    self.assertIn("not clearly off", check["detail"])
                if word == "On":
                    self.assertIn("is on in", check["detail"])

    def test_unclear_value_warns_naming_it(self):
        self.hermes("auth:\n  adopt_external_logins: maybe\n")
        check = self.checks(self.doctor(roster=self.full_roster())[0])[
            "hermes-logins"]
        self.assertEqual(check["status"], "warn")
        self.assertIn("maybe", check["detail"])

    def test_quoted_value_is_a_string_never_a_bool(self):
        # PyYAML hands Hermes a quoted "false" as a non-empty, truthy
        # string; miniyaml strips the quotes, so doctor must not read it
        # as a bool word
        for raw, status in (('"false"', "warn"), ("'no'", "warn"),
                            ("false", "pass"), ('"true"', "warn")):
            with self.subTest(raw=raw):
                self.hermes(f"auth:\n  adopt_external_logins: {raw}\n")
                check = self.checks(self.doctor(
                    roster=self.full_roster())[0])["hermes-logins"]
                self.assertEqual(check["status"], status, check)
                if status == "warn":
                    self.assertTrue(check["fix"])
                    self.assertIn("not clearly off", check["detail"])
                    self.assertIn(raw.strip("'\""), check["detail"])

    def test_bom_does_not_hide_the_auth_block(self):
        path = self.hermes(None)
        path.write_bytes(b"\xef\xbb\xbfauth:\n  adopt_external_logins: true\n")
        check = self.checks(self.doctor(roster=self.full_roster())[0])[
            "hermes-logins"]
        self.assertEqual(check["status"], "warn", check)
        self.assertIn("is on in", check["detail"])

    def test_unreadable_warns_naming_the_path(self):
        path = self.hermes("providers: [a, b]\n")
        check = self.checks(self.doctor(roster=self.full_roster())[0])[
            "hermes-logins"]
        self.assertEqual(check["status"], "warn")
        self.assertIn(str(path), check["detail"])


class JsonShape(DoctorCase):
    def main_lines(self, argv) -> tuple[list[str], int]:
        out = io.StringIO()
        with redirect_stdout(out):
            code = cli_main.main(argv, fetch=self.fetch, runner=self.host,
                                 env=self.env, platform=self.plat,
                                 probe=self.host.probe, env_store=self.store,
                                 sleep=self.clock.sleep, clock=self.clock.now,
                                 spawn_detached=self.spawn,
                                 cli_version=self.cli_version,
                                 now=lambda: NOW)
        return out.getvalue().strip().splitlines(), code

    def test_json_is_one_object_ending_with_the_status_block(self):
        roster = str(self.full_roster())
        lines, code = self.main_lines(["doctor", "--json", "--roster", roster])
        self.assertEqual((code, len(lines)), (0, 1))
        obj = json.loads(lines[0])
        self.assertEqual(list(obj)[-4:], ["status", "intent", "artifacts",
                                          "reason"])
        block = {k: obj[k] for k in list(obj)[-4:]}
        self.assertIsNone(conformance._block_problem(
            block, SCHEMA, "tk-studio-cli-doctor"))
        self.assertEqual(set(block) - set(SCHEMA["properties"]), set())
        self.assertEqual(obj["status"], "complete")
        self.assertIn("plugin", obj["reason"])
        for key in ("mode", "folder", "root", "supervisor", "studio_web",
                    "checks"):
            self.assertIn(key, obj)
        self.assertNotIn("_lines", obj)
        for check in obj["checks"]:
            self.assertLessEqual({"check", "status", "detail", "fix"},
                                 set(check))
            self.assertIn(check["status"], ("pass", "fail", "warn",
                                            "skipped"))
            if check["status"] != "pass":
                self.assertTrue(check["fix"])

    def test_human_prints_one_line_per_check_then_the_json(self):
        lines, code = self.main_lines(["doctor", "--roster",
                                       str(self.full_roster())])
        obj = json.loads(lines[-1])
        self.assertEqual(len(lines) - 1, len(obj["checks"]))
        for line, check in zip(lines, obj["checks"]):
            self.assertTrue(line.startswith(check["status"]))
            self.assertIn(check["check"], line)

    def test_other_verbs_keep_their_line(self):
        _, last, _ = self.main_out(["status", "--roster",
                                    str(ROSTERS / "latest.json")])
        self.assertEqual(list(last)[:4], ["status", "intent", "artifacts",
                                          "reason"])
        self.assertNotIn("checks", last)


class ConformanceDrive(unittest.TestCase):
    def drive(self) -> dict:
        manifest = json.loads((PLUGIN_ROOT / "contracts" / "conformance"
                               / "manifest.json").read_text(encoding="utf-8"))
        drives = manifest["cli_drives"]["drives"]
        self.assertEqual([d["assertion"] for d in drives], ["cli-doctor-json"])
        return drives[0]

    def test_the_doctor_drive_passes_from_the_checkout(self):
        check = conformance._run_cli_drive(self.drive(), SCHEMA, 120)
        self.assertTrue(check["ok"], check)
        self.assertNotIn("state", check)

    def test_no_checkout_is_not_run_never_a_failure(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            check = conformance._run_cli_drive(self.drive(), SCHEMA, 120,
                                               repo=Path(tmp))
        self.assertTrue(check["ok"])
        self.assertEqual(check["state"], "not run")
        self.assertIn("not run", check["detail"])

    def test_a_crashed_doctor_fails_the_drive(self):
        import subprocess
        drive = self.drive()
        for code, status in ((1, "blocked"), (0, "blocked"),
                             (1, "complete")):
            with self.subTest(code=code, status=status):
                out = json.dumps({"checks": [], "status": status,
                                  "intent": drive["intent"],
                                  "artifacts": [],
                                  "reason": "doctor crashed: boom"})
                proc = subprocess.CompletedProcess([], code, out + "\n", "")
                with mock.patch.object(conformance.subprocess, "run",
                                       return_value=proc):
                    check = conformance._run_cli_drive(drive, SCHEMA, 120)
                self.assertFalse(check["ok"], check)
                self.assertIn(f"exit {code}", check["detail"])
                self.assertIn(status, check["detail"])

    def test_the_cli_sits_in_this_checkout(self):
        self.assertEqual(conformance.REPO_ROOT, REPO_ROOT)


class SuiteCliDrives(AppsCase):
    """driver-contract §8 (0.1.20): the suite reports its CLI drives in a
    top-level ``cli_drives`` field, and a failed one is a ``failures[]``
    entry (surface ``tk-studio-cli``) that turns ``ok`` false. Driven
    through ``run_suite`` on a fixture with no skill surfaces, the drive
    itself patched (its own tests are ConformanceDrive's)."""

    def suite(self, check: dict) -> tuple[dict, list]:
        manifest = json.loads((PLUGIN_ROOT / "contracts" / "conformance"
                               / "manifest.json").read_text(encoding="utf-8"))
        drive = manifest["cli_drives"]["drives"][0]
        skills = self.tmp / "skills"
        skills.mkdir()
        path = self.tmp / "manifest.json"
        path.write_text(json.dumps({
            "conformance_version": manifest.get("conformance_version", 1),
            "surfaces": {}, "cli_drives": {"drives": [drive]}}))
        with mock.patch.object(conformance, "_run_cli_drive",
                               return_value=check) as run:
            report = conformance.run_suite(skills_dir=skills,
                                           manifest_path=path, emit=False)
        self.assertEqual(run.call_count, 1)
        self.assertEqual(run.call_args.args[0], drive)
        return report, drive

    def test_a_passing_drive_is_listed_and_ok(self):
        check = {"assertion": "cli-doctor-json", "ok": True, "detail": ""}
        report, _ = self.suite(check)
        self.assertEqual(report["cli_drives"], [check])
        self.assertEqual(report["failures"], [])
        self.assertIs(report["ok"], True)

    def test_a_failed_drive_is_a_named_failure_and_not_ok(self):
        check = {"assertion": "cli-doctor-json", "ok": False,
                 "detail": "exit 1, status blocked"}
        report, _ = self.suite(check)
        self.assertEqual(report["cli_drives"], [check])
        self.assertEqual(report["failures"], [
            {"surface": "tk-studio-cli", "assertion": "cli-doctor-json",
             "detail": "exit 1, status blocked"}])
        self.assertIs(report["ok"], False)


if __name__ == "__main__":
    unittest.main()
