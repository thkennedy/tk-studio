"""tk-studio login — sign a host tool in again from the owner's secret store
(DW-170, hole 111), unattended and without the secret ever reaching an
argument, a log, a transcript or this verb's output.

  uv run login.py <tool> [--config PATH] [--dry-run]

The store is 1Password: a machine vault the owner fills once, read by a
service account scoped to that vault whose token is the one secret on the
box — the User environment variable ``OP_SERVICE_ACCOUNT_TOKEN`` (``HKCU\\
Environment`` on Windows, then the process env; ``_core.user_env``). Which
item signs which tool in is the supervisor config's ``logins:`` mapping
(``TK_SUPERVISOR_CONFIG``, or ``--config``), a text scan like
``sandbox_login.config_sandboxes`` (the config's quoted job keys are outside
the studio's YAML subset):

    logins:
      sbx:
        item: "op://Agent PC/Docker Hub Personal Access Token"
        username_field: username      # default
        secret_field: credential      # default

Each tool has one fixed argv (``TOOLS``): ``sbx`` runs ``sbx login
--username <username> --password-stdin`` with the secret on stdin, the
headless form Docker documents for a personal access token. The username
and the secret are read with ``op read op://<vault>/<item>/<field>
--no-newline`` under the token; both stay in this process. The answer
carries their lengths, never their text, and every clipped tool output has
the secret scrubbed before it is kept.

Refusals end ``blocked`` (exit 2), each by name and before any call where
possible: ``ToolUnknown`` (no fixed argv for the tool), ``ConfigMissing``
(no ``--config`` and no ``TK_SUPERVISOR_CONFIG``, or unreadable),
``LoginNotConfigured`` (no ``logins.<tool>.item``), ``OpMissing`` (no ``op``
on PATH and no ``TK_OP_BIN``), ``TokenMissing`` (no
``OP_SERVICE_ACCOUNT_TOKEN``), ``ReadRefused`` (an ``op read`` that fails:
its stderr clipped) and ``LoginFailed`` (the tool's login exits non-zero:
its output clipped and scrubbed). A dry run resolves everything, reads
nothing and runs nothing. The supervisor calls this verb once per drain
pass on a ``pin-failed`` whose text says the sandbox tier is not signed in
(``claimGate``), then pins again; the operator calls it by hand after
``sbx ls`` answers ``not signed in to Docker``. Stdlib-only (NFR9); never
prompts; writes nothing.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

import _core

INTENT = "tk-studio-login"
TOKEN_VAR = "OP_SERVICE_ACCOUNT_TOKEN"
OP_BIN_VAR = "TK_OP_BIN"
CONFIG_VAR = "TK_SUPERVISOR_CONFIG"
CLIP = 300
READ_TIMEOUT_S = 60
LOGIN_TIMEOUT_S = 120

# the one argv per tool: `{username}` is replaced, the secret goes on stdin
TOOLS: dict[str, dict] = {
    "sbx": {"argv": ["sbx", "login", "--username", "{username}", "--password-stdin"],
            "what": "the engine sandbox's Docker sign-in"},
}
DEFAULT_FIELDS = {"username_field": "username", "secret_field": "credential"}
_LOGIN_KEYS = ("item", "username_field", "secret_field")

# a module attribute so tests stub the registry read here (as the lib does)
_hkcu_value = _core._hkcu_value


class Refusal(Exception):
    """A named refusal: nothing ran (status blocked, exit 2)."""

    def __init__(self, name: str, detail: str):
        super().__init__(f"{name}: {detail}")
        self.name = name
        self.detail = detail


def _unquote(value: str) -> str:
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
        return value[1:-1]
    return value


def _strip_comment(value: str) -> str:
    # a ' #' outside quotes starts a comment, as sandbox_login's scan reads it
    quote = None
    for i, ch in enumerate(value):
        if quote:
            if ch == quote:
                quote = None
        elif ch in "\"'":
            quote = ch
        elif ch == "#" and (i == 0 or value[i - 1] in " \t"):
            return value[:i]
    return value


def config_logins(text: str) -> dict[str, dict[str, str]]:
    """The ``logins:`` mapping of the supervisor config text: ``{tool:
    {item, username_field, secret_field}}``, block style only (a tool line
    indented under ``logins:``, its keys indented further). Lines outside the
    block, comments and unknown keys are ignored; defaults fill the fields."""
    logins: dict[str, dict[str, str]] = {}
    in_block = False
    block_indent = 0
    tool: str | None = None
    tool_indent = 0
    for raw in text.splitlines():
        line = _strip_comment(raw.rstrip())
        if not line.strip():
            continue
        indent = len(line) - len(line.lstrip(" "))
        stripped = line.strip()
        if not in_block:
            if indent == 0 and re.fullmatch(r"logins:\s*", stripped):
                in_block, block_indent, tool = True, 0, None
            continue
        if indent <= block_indent:
            in_block = False
            continue
        m = re.fullmatch(r"([A-Za-z0-9_.-]+):\s*(.*)", stripped)
        if not m:
            continue
        key, value = m.group(1), m.group(2)
        if tool is None or indent <= tool_indent:
            if value:
                continue  # a scalar where a tool mapping should be
            tool, tool_indent = key, indent
            logins[tool] = dict(DEFAULT_FIELDS)
            continue
        if key in _LOGIN_KEYS and value:
            logins[tool][key] = _unquote(value)
    return {t: v for t, v in logins.items() if v.get("item")}


def resolve_op(env, *, which=shutil.which, read=None) -> str:
    """The 1Password CLI: ``TK_OP_BIN`` (a User variable, then the env),
    else ``op`` on PATH. ``OpMissing`` otherwise."""
    pinned = _core.user_env(OP_BIN_VAR, env, read=read)
    if pinned:
        if Path(pinned).is_file():
            return pinned
        raise Refusal("OpMissing", f"{OP_BIN_VAR} names {pinned}, which is not a file")
    found = which("op", path=env.get("PATH") or env.get("Path") or None)
    if found:
        return found
    raise Refusal("OpMissing", f"no `op` on PATH and no {OP_BIN_VAR}: install the 1Password CLI "
                                "(winget install AgileBits.1Password.CLI)")


def _default_run(argv: list[str], *, env: dict, input_text: str | None, timeout: float):
    proc = subprocess.run(argv, env=env, input=input_text, capture_output=True, text=True,
                          encoding="utf-8", errors="replace", timeout=timeout)
    return proc.returncode, proc.stdout or "", proc.stderr or ""


def _clip(text: str, *secrets: str) -> str:
    for s in secrets:
        if s:
            text = text.replace(s, "***")
    text = re.sub(r"\s+", " ", text).strip()
    return text[:CLIP]


def login(tool: str, *, config_text: str | None, env=None, run=_default_run,
          which=shutil.which, read=None, dry_run: bool = False) -> dict:
    """Sign ``tool`` in from the store; the answer never carries a value."""
    env = dict(os.environ if env is None else env)
    result: dict = {"ok": False, "tool": tool, "dry_run": dry_run, "item": None,
                    "op": None, "username_length": None, "secret_length": None,
                    "argv": None, "exit": None, "output": None, "written": []}

    def finish(status: str, reason: str | None) -> dict:
        return _core.with_block(result, status, [], reason, intent=INTENT)

    try:
        if tool not in TOOLS:
            raise Refusal("ToolUnknown", f"no login for `{tool}`; known: {', '.join(sorted(TOOLS))}")
        if config_text is None:
            raise Refusal("ConfigMissing", f"no --config and no {CONFIG_VAR}: the `logins:` mapping names the item")
        logins = config_logins(config_text)
        entry = logins.get(tool)
        if not entry:
            raise Refusal("LoginNotConfigured", f"the config's `logins:` names no `{tool}` item "
                                                f"(configured: {', '.join(sorted(logins)) or 'none'})")
        result["item"] = entry["item"]
        op = resolve_op(env, which=which, read=read)
        result["op"] = op
        token = _core.user_env(TOKEN_VAR, env, read=read)
        if not token:
            raise Refusal("TokenMissing", f"{TOKEN_VAR} is not set as a User variable or in the environment")
        spec = TOOLS[tool]
        result["argv"] = [a.replace("{username}", "<username>") for a in spec["argv"]]
        if dry_run:
            result["ok"] = True
            return finish("complete", f"dry run: would read {entry['item']}/{entry['username_field']} and "
                                      f"/{entry['secret_field']}, then run {' '.join(result['argv'])}")
        op_env = {**env, TOKEN_VAR: token}

        def op_read(field: str) -> str:
            ref = f"{entry['item']}/{field}"
            try:
                rc, out, err = run([op, "read", ref, "--no-newline"], env=op_env, input_text=None,
                                   timeout=READ_TIMEOUT_S)
            except (OSError, subprocess.TimeoutExpired) as exc:
                raise Refusal("ReadRefused", f"op read {ref}: {type(exc).__name__}: {exc}") from None
            if rc != 0:
                raise Refusal("ReadRefused", f"op read {ref} exited {rc}: {_clip(err or out, token)}")
            return out.strip("\r\n")

        username = op_read(entry["username_field"])
        secret = op_read(entry["secret_field"])
        result["username_length"] = len(username)
        result["secret_length"] = len(secret)
        if not username or not secret:
            raise Refusal("ReadRefused", f"{entry['item']}: the "
                          f"{'username' if not username else 'secret'} field is empty")
        argv = [a.replace("{username}", username) for a in spec["argv"]]
        tool_env = {k: v for k, v in env.items() if k != TOKEN_VAR}  # the tool never sees the store's token
        try:
            rc, out, err = run(argv, env=tool_env, input_text=secret, timeout=LOGIN_TIMEOUT_S)
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise Refusal("LoginFailed", f"{argv[0]} login: {type(exc).__name__}: {exc}") from None
        result["exit"] = rc
        result["output"] = _clip((out + " " + err), secret, token).replace(username, "<username>")
        if rc != 0:
            raise Refusal("LoginFailed", f"{argv[0]} login exited {rc}: {result['output']}")
        result["ok"] = True
        return finish("complete", None)
    except Refusal as exc:
        return finish("blocked", f"{exc.name}: {exc.detail}")


def _config_text(path: str | None, env) -> str | None:
    target = path or (env.get(CONFIG_VAR) or "").strip() or None
    if not target:
        return None
    try:
        return Path(target).read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        raise Refusal("ConfigMissing", f"{target} is unreadable ({exc})") from None


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(prog="login.py", description=__doc__.splitlines()[0])
    parser.add_argument("tool")
    parser.add_argument("--config", default=None, help=f"the supervisor config (default {CONFIG_VAR})")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)
    env = dict(os.environ)
    try:
        text = _config_text(args.config, env)
    except Refusal as exc:
        result = _core.with_block({"ok": False, "tool": args.tool, "dry_run": args.dry_run},
                                  "blocked", [], f"{exc.name}: {exc.detail}", intent=INTENT)
    else:
        result = login(args.tool, config_text=text, env=env, dry_run=args.dry_run, read=_hkcu_value)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result.get("status") == "complete" else 2


if __name__ == "__main__":
    sys.exit(main())
