"""login.py (DW-170, hole 111): the config scan, the refusals by name, the
dry run, a sign-in through a fake `op` and tool, and the one rule above the
rest — no secret, token or username text ever reaches the answer."""
from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import login  # noqa: E402

CONFIG = """# the box's supervisor config
jobs:
  "tk-studio/run-epic-37":
    tier: sbx
    sandbox: claude-tk-studio
logins:
  sbx:
    item: "op://Agent PC/Docker Hub Personal Access Token"   # the PAT item
  gh:
    item: op://Agent PC/GitHub token
    secret_field: token
other: 1
"""
TOKEN = "fake-store-token-" + "t" * 40  # shaped like no real token
USERNAME = "timhkennedy"
SECRET = "fake-tool-secret-" + "s" * 24  # shaped like no real PAT


class FakeRun:
    """`op read` answers the item's fields; the tool's login answers `login_rc`."""

    def __init__(self, *, login_rc=0, read_rc=0, fields=None):
        self.calls: list[dict] = []
        self.login_rc = login_rc
        self.read_rc = read_rc
        self.fields = fields or {"username": USERNAME, "credential": SECRET}

    def __call__(self, argv, *, env, input_text, timeout):
        self.calls.append({"argv": list(argv), "env": dict(env), "input": input_text, "timeout": timeout})
        if argv[1:2] == ["read"]:
            if self.read_rc:
                return self.read_rc, "", f"[ERROR] could not read {argv[2]} with {env.get('OP_SERVICE_ACCOUNT_TOKEN')}"
            return 0, self.fields.get(argv[2].rsplit("/", 1)[-1], ""), ""
        if self.login_rc:
            return self.login_rc, "", f"error: auth login failed: invalid Docker credentials ({input_text})"
        return 0, f"Signed in as {argv[3]}.\n", ""


def which_op(name, path=None):
    return "C:/op/op.exe" if name == "op" else None


def run_login(tool="sbx", *, config=CONFIG, env=None, run=None, which=which_op, dry_run=False):
    env = {"PATH": "C:/op", "OP_SERVICE_ACCOUNT_TOKEN": TOKEN} if env is None else env
    run = FakeRun() if run is None else run
    result = login.login(tool, config_text=config, env=env, run=run, which=which, read=lambda n: None, dry_run=dry_run)
    return result, run


class ConfigScan(unittest.TestCase):
    def test_block_style_tools_with_defaults_and_overrides(self):
        logins = login.config_logins(CONFIG)
        self.assertEqual(logins["sbx"], {"item": "op://Agent PC/Docker Hub Personal Access Token",
                                         "username_field": "username", "secret_field": "credential"})
        self.assertEqual(logins["gh"]["secret_field"], "token")
        self.assertEqual(logins["gh"]["item"], "op://Agent PC/GitHub token")

    def test_no_block_or_no_item_is_empty(self):
        self.assertEqual(login.config_logins("jobs:\n  p/j:\n    tier: host\n"), {})
        self.assertEqual(login.config_logins("logins:\n  sbx:\n    username_field: u\n"), {})
        self.assertEqual(login.config_logins("logins: {}\nsbx:\n  item: op://x/y\n"), {})


class Refusals(unittest.TestCase):
    def assert_blocked(self, result, name):
        self.assertEqual(result["status"], "blocked")
        self.assertTrue(result["reason"].startswith(name + ":"), result["reason"])
        self.assertFalse(result["ok"])
        self.assertEqual(result["intent"], "tk-studio-login")
        self.assertEqual(list(result)[-4:], ["status", "intent", "artifacts", "reason"])

    def test_unknown_tool(self):
        result, run = run_login("docker")
        self.assert_blocked(result, "ToolUnknown")
        self.assertEqual(run.calls, [])

    def test_config_missing_and_not_configured(self):
        result, run = run_login(config=None)
        self.assert_blocked(result, "ConfigMissing")
        result, run = run_login(config="jobs:\n  p/j:\n    tier: sbx\n")
        self.assert_blocked(result, "LoginNotConfigured")
        self.assertIn("configured: none", result["reason"])
        self.assertEqual(run.calls, [])

    def test_op_missing_then_token_missing(self):
        result, run = run_login(which=lambda n, path=None: None, env={"PATH": "", "OP_SERVICE_ACCOUNT_TOKEN": TOKEN})
        self.assert_blocked(result, "OpMissing")
        result, run = run_login(env={"PATH": "C:/op"})
        self.assert_blocked(result, "TokenMissing")
        self.assertEqual(run.calls, [])

    def test_tk_op_bin_pins_the_binary(self):
        env = {"PATH": "", "OP_SERVICE_ACCOUNT_TOKEN": TOKEN, "TK_OP_BIN": str(Path(login.__file__))}
        result, run = run_login(env=env, which=lambda n, path=None: None)
        self.assertEqual(result["status"], "complete")
        self.assertEqual(run.calls[0]["argv"][0], str(Path(login.__file__)))

    def test_read_refused_names_the_ref_and_scrubs_the_token(self):
        result, run = run_login(run=FakeRun(read_rc=1))
        self.assert_blocked(result, "ReadRefused")
        self.assertIn("op://Agent PC/Docker Hub Personal Access Token/username", result["reason"])
        self.assertNotIn(TOKEN, json.dumps(result))
        self.assertIn("***", result["reason"])
        self.assertEqual(len(run.calls), 1)  # the first read refused: no second read, no login

    def test_empty_field_is_read_refused(self):
        result, run = run_login(run=FakeRun(fields={"username": USERNAME, "credential": ""}))
        self.assert_blocked(result, "ReadRefused")
        self.assertIn("secret field is empty", result["reason"])

    def test_login_failed_keeps_the_exit_and_scrubs_the_secret(self):
        result, run = run_login(run=FakeRun(login_rc=1))
        self.assert_blocked(result, "LoginFailed")
        self.assertEqual(result["exit"], 1)
        text = json.dumps(result)
        self.assertNotIn(SECRET, text)
        self.assertNotIn(TOKEN, text)
        self.assertIn("invalid Docker credentials (***)", result["output"])


class SignIn(unittest.TestCase):
    def test_reads_both_fields_under_the_token_then_logs_in_on_stdin(self):
        result, run = run_login()
        self.assertEqual(result["status"], "complete")
        self.assertTrue(result["ok"])
        reads = [c for c in run.calls if c["argv"][1] == "read"]
        self.assertEqual([c["argv"][2] for c in reads],
                         ["op://Agent PC/Docker Hub Personal Access Token/username",
                          "op://Agent PC/Docker Hub Personal Access Token/credential"])
        for c in reads:
            self.assertEqual(c["argv"][-1], "--no-newline")
            self.assertEqual(c["env"]["OP_SERVICE_ACCOUNT_TOKEN"], TOKEN)
            self.assertIsNone(c["input"])
        last = run.calls[-1]
        self.assertEqual(last["argv"], ["sbx", "login", "--username", USERNAME, "--password-stdin"])
        self.assertEqual(last["input"], SECRET)
        self.assertNotIn("OP_SERVICE_ACCOUNT_TOKEN", last["env"])  # the tool never sees the store's token
        self.assertEqual(result["exit"], 0)
        self.assertEqual(result["username_length"], len(USERNAME))
        self.assertEqual(result["secret_length"], len(SECRET))

    def test_the_answer_never_carries_a_value(self):
        result, _ = run_login()
        text = json.dumps(result)
        for value in (SECRET, TOKEN, USERNAME):
            self.assertNotIn(value, text)
        self.assertEqual(result["argv"], ["sbx", "login", "--username", "<username>", "--password-stdin"])
        self.assertEqual(result["output"], "Signed in as <username>.")

    def test_dry_run_resolves_everything_and_runs_nothing(self):
        result, run = run_login(dry_run=True)
        self.assertEqual(result["status"], "complete")
        self.assertTrue(result["dry_run"])
        self.assertEqual(run.calls, [])
        self.assertIn("would read op://Agent PC/Docker Hub Personal Access Token/username", result["reason"])
        self.assertEqual(result["op"], "C:/op/op.exe")

    def test_a_crlf_field_is_stripped(self):
        run = FakeRun(fields={"username": USERNAME + "\r\n", "credential": SECRET + "\n"})
        result, run = run_login(run=run)
        self.assertEqual(result["status"], "complete")
        self.assertEqual(run.calls[-1]["argv"][3], USERNAME)
        self.assertEqual(run.calls[-1]["input"], SECRET)


class Cli(unittest.TestCase):
    def test_main_reads_the_config_from_the_variable_and_exits_2_on_a_refusal(self):
        import io
        import os
        import contextlib
        out = io.StringIO()
        saved = dict(os.environ)
        try:
            os.environ.pop("TK_SUPERVISOR_CONFIG", None)
            with contextlib.redirect_stdout(out):
                rc = login.main(["sbx"])
        finally:
            os.environ.clear()
            os.environ.update(saved)
        self.assertEqual(rc, 2)
        result = json.loads(out.getvalue())
        self.assertTrue(result["reason"].startswith("ConfigMissing:"))
        self.assertEqual(result["intent"], "tk-studio-login")


if __name__ == "__main__":
    unittest.main()
