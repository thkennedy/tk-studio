"""The engine sandbox's Max login (Story 33.2): when the refresh token of the
global ``anthropic`` sbx secret expires, read from inside the sandbox, shared
by the activate drift check's ``sandbox-login`` plane and ``tk-studio
doctor``'s ``sandbox-login`` check.

The sandboxes are the distinct ``jobs.*.sandbox`` values of the supervisor
config (``TK_SUPERVISOR_CONFIG``), read as text (``config_sandboxes``): there
is no other source and no default. The read order is the runbook's rule
(§3.5 and the hole-68 row): ``sbx daemon status`` first and no other sbx
command until it passes, then ``sbx ls``, and ``sbx exec`` only on a sandbox
``sbx ls`` lists as running. Through ``sbx exec`` only two facts leave the
sandbox: ``loggedIn`` (``claude auth status --json``, the supervisor's own
probe) and ``refreshTokenExpiresAt`` from ``~/.claude/.credentials.json``
(the in-sandbox script prints that one field, never a token).

Each sandbox reads as one case: ``ok`` (logged in, more than ``WARN_DAYS``
days left), ``expiring`` (``WARN_DAYS`` days or fewer, or the expiry could
not be read), ``expired`` (the instant passed, or logged out) or
``no-sandbox`` (nothing to read: none configured, sbx absent, the daemon
down, the sandbox not running). The callers map the case onto their own
statuses; the renewal is ``sbx run --name <sandbox>`` → ``/login`` →
``/exit``.

Stdlib only: this file is byte-identical in ``plugins/tk-studio/lib/`` and in
the sealed CLI wheel (``tools/installer/cli/tk_studio_cli/``).
"""
from __future__ import annotations

import json
import math
import re
import subprocess
import time
from datetime import datetime, timezone

WARN_DAYS = 7
DAY = 86400
# one whole reading's wall-clock budget (every sbx call of it together), well
# below the conformance runner's 60 s bound on the activate drift check
BUDGET_S = 20
OK, EXPIRING, EXPIRED, NO_SANDBOX = "ok", "expiring", "expired", "no-sandbox"
# the worst case wins when several sandboxes are configured
_ORDER = (EXPIRED, EXPIRING, OK, NO_SANDBOX)

AUTH_STATUS = ("env", "-u", "ANTHROPIC_API_KEY", "claude", "auth", "status",
               "--json")
# runs inside the sandbox; prints refreshTokenExpiresAt alone (or nothing)
EXPIRY_SCRIPT = (
    "import json, os\n"
    "p = os.path.expanduser('~/.claude/.credentials.json')\n"
    "try:\n"
    "    v = json.load(open(p)).get('claudeAiOauth', {})"
    ".get('refreshTokenExpiresAt')\n"
    "except Exception:\n"
    "    v = None\n"
    "print('' if v is None else v)\n")
FIX_DAEMON = ("start the sbx daemon only through the sign-in task or "
              "start.ps1 (runbook §3.5, §4.3); nothing to do on a box with "
              "no engine sandbox")
FIX_NO_CONFIG = ("nothing to do on a box with no engine sandbox; on the "
                 "engine box set TK_SUPERVISOR_CONFIG to the supervisor "
                 "config naming jobs.<project>/<job>.sandbox")


def renewal_steps(sandbox: str) -> str:
    return f"sbx run --name {sandbox} → /login → /exit"


def renewal_fix(sandbox: str) -> str:
    return (f"renew the Max login from inside the sandbox: "
            f"{renewal_steps(sandbox)}")


_FLOW_SANDBOX = re.compile(
    r"""(?:^|[{,])\s*(["']?)sandbox\1\s*:\s*"""
    r"""("[^"]*"|'[^']*'|[^\s,{}\[\]#][^,{}\[\]#]*)""")


def _unquote(value: str) -> str:
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
        value = value[1:-1].strip()
    return value


def _depth_after(line: str, depth: int) -> int:
    """The flow-mapping/sequence depth after ``line`` (brackets inside a
    quoted string or a trailing comment do not count)."""
    quote = ""
    for i, ch in enumerate(line):
        if quote:
            if ch == quote:
                quote = ""
        elif ch in "'\"":
            quote = ch
        elif ch == "#" and (i == 0 or line[i - 1].isspace()):
            break
        elif ch in "{[":
            depth += 1
        elif ch in "}]":
            depth = max(0, depth - 1)
    return depth


def config_sandboxes(text: str) -> list[str]:
    """The distinct ``sandbox`` values under the config's top-level
    ``jobs:`` mapping, in order of appearance. A text scan, not a YAML
    parser (the config's quoted ``"<project-id>/<job-id>"`` keys are outside
    the studio's YAML subset; the supervisor itself reads it with js-yaml):
    a block-style ``sandbox:`` line nested under ``jobs:``, its value
    unquoted and stripped of a trailing comment, or a ``sandbox:`` entry of
    a flow mapping under ``jobs:`` (``"p/j": {tier: sbx, sandbox: s}``, on
    one line or several, or ``jobs: {...}`` itself)."""
    names: list[str] = []

    def add(value: str) -> None:
        value = _unquote(value)
        if value and value not in names:
            names.append(value)

    def flow(segment: str) -> None:
        for m in _FLOW_SANDBOX.finditer(segment):
            add(m.group(2))

    in_jobs = False
    depth = 0
    for raw in text.splitlines():
        line = raw.rstrip()
        if depth > 0:
            # a continuation line inside a flow collection
            if in_jobs:
                flow(line)
            depth = _depth_after(line, depth)
            continue
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        if not line[:1].isspace():
            top = re.match(r"^jobs\s*:(.*)$", line)
            in_jobs = top is not None
            if in_jobs and "{" in top.group(1):
                flow(top.group(1)[top.group(1).index("{"):])
            depth = _depth_after(line, 0)
            continue
        if in_jobs:
            m = re.match(r"^\s+sandbox\s*:\s*(.*)$", line)
            if m is not None and not m.group(1).lstrip().startswith("{"):
                add(re.sub(r"\s+#.*$", "", m.group(1)))
            elif "{" in line:
                flow(line[line.index("{"):])
        depth = _depth_after(line, 0)
    return names


def _iso(seconds: float) -> str:
    return datetime.fromtimestamp(seconds, timezone.utc).strftime(
        "%Y-%m-%dT%H:%M:%SZ")


def _instant(seconds: float) -> float | None:
    """``seconds`` when ``_iso`` can render it (finite, a representable
    instant); else None."""
    if not math.isfinite(seconds):
        return None
    try:
        datetime.fromtimestamp(seconds, timezone.utc)
    except (OverflowError, ValueError, OSError):
        return None
    return seconds


def parse_expiry(text: str) -> float | None:
    """``refreshTokenExpiresAt`` as epoch seconds: milliseconds since the
    epoch (as Claude Code writes it), seconds, or an ISO instant; else
    None (also for ``nan``, ``inf`` or an instant no date can hold)."""
    value = (text or "").strip()
    if not value:
        return None
    try:
        number = float(value)
    except ValueError:
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        try:
            return _instant(parsed.timestamp())
        except (OverflowError, ValueError, OSError):
            return None
    if not math.isfinite(number) or number <= 0:
        return None
    return _instant(number / 1000 if number > 1e11 else number)


class Deadline:
    """One reading's total budget: ``left()`` seconds remain of ``seconds``
    (``clock`` is monotonic; injectable for tests)."""

    def __init__(self, seconds: float = BUDGET_S, clock=time.monotonic):
        self.seconds = seconds
        self._clock = clock
        self._end = clock() + seconds

    def left(self) -> float:
        return self._end - self._clock()


class _Spent(Exception):
    """The reading's budget ran out before or during ``args``."""

    def __init__(self, args: list[str]):
        super().__init__(" ".join(args[:3]))
        self.argv = args


def _call(run, args: list[str], deadline: Deadline | None = None):
    """``(proc, None)`` or ``(None, why)``; ``why`` is ``"absent"`` when the
    executable is not on PATH. Under a ``deadline`` the call is given the
    time left (``run(args, timeout)``) and a spent budget raises ``_Spent``
    (a timeout under it spent the budget too)."""
    left = None
    if deadline is not None:
        left = deadline.left()
        if left <= 0:
            raise _Spent(args)
    try:
        return (run(args) if left is None else run(args, left)), None
    except FileNotFoundError:
        return None, "absent"
    except subprocess.TimeoutExpired as exc:
        if deadline is not None:
            raise _Spent(args) from exc
        return None, f"{type(exc).__name__}: {exc}"
    except OSError as exc:
        return None, f"{type(exc).__name__}: {exc}"


def _out(proc) -> str:
    return ((proc.stdout or "") + " " + (proc.stderr or "")).strip()[:200]


def _listed(ls_output: str, sandbox: str) -> str | None:
    for line in (ls_output or "").splitlines():
        cols = line.split()
        if cols and cols[0] == sandbox:
            return line.strip()
    return None


def _one(case: str, detail: str, fix: str | None, **extra) -> dict:
    return {"case": case, "detail": detail, "fix": fix, **extra}


def _read_one(sandbox: str, run, now: float,
              deadline: Deadline | None = None) -> dict:
    auth, why = _call(run, ["sbx", "exec", sandbox, *AUTH_STATUS], deadline)
    logged_in: bool | None = None
    probe = why
    if auth is not None:
        try:
            status = json.loads((auth.stdout or "").strip())
            if auth.returncode == 0 and isinstance(status, dict) \
                    and isinstance(status.get("loggedIn"), bool):
                logged_in = status["loggedIn"]
            else:
                probe = f"claude auth status exit {auth.returncode}"
        except ValueError:
            probe = (f"claude auth status exit {auth.returncode}, "
                     "unparseable")
    fix = renewal_fix(sandbox)
    if logged_in is False:
        return _one(EXPIRED, "the sandbox reports logged out (claude auth "
                    "status: loggedIn false)", fix)
    cred, why = _call(run, ["sbx", "exec", sandbox, "python3", "-c",
                            EXPIRY_SCRIPT], deadline)
    expiry = parse_expiry(cred.stdout) \
        if cred is not None and cred.returncode == 0 else None
    if expiry is None:
        unread = why or (f"exit {cred.returncode}" if cred.returncode
                         else "no refreshTokenExpiresAt in "
                         "~/.claude/.credentials.json")
        return _one(EXPIRING, f"refreshTokenExpiresAt could not be read "
                    f"({unread}); renew to be sure", fix)
    left = expiry - now
    at = _iso(expiry)
    if left <= 0:
        return _one(EXPIRED, f"the Max login expired at {at}", fix,
                    expires_at=at)
    days = left / DAY
    if days <= WARN_DAYS:
        return _one(EXPIRING, f"the Max login expires at {at}, in "
                    f"{days:.1f} days (warned from {WARN_DAYS} days)", fix,
                    expires_at=at)
    if logged_in is None:
        return _one(EXPIRING, f"the login probe failed ({probe}); the "
                    f"refresh token expires at {at}", fix, expires_at=at)
    return _one(OK, f"logged in; the Max login expires at {at}, in "
                f"{days:.0f} days", None, expires_at=at)


def read_logins(sandboxes: list[str], run, now: float, *,
                daemon_checked: bool = False,
                deadline: Deadline | None = None) -> dict:
    """The worst case over ``sandboxes`` with each sandbox's own reading:
    ``{case, detail, fix, sandboxes: [{sandbox, case, detail, fix,
    expires_at?}]}``. ``run(argv)`` answers ``returncode``, ``stdout`` and
    ``stderr`` (raising ``FileNotFoundError`` when sbx is absent);
    ``daemon_checked``: the caller's own ``sbx daemon status`` passed. Under
    a ``deadline`` (one total budget for every sbx call of the reading)
    ``run(argv, timeout)`` is given the time left, and a spent budget reads
    as ``no-sandbox`` like an unreachable daemon, the detail naming the
    timeout. A budget spent part-way through the sandboxes keeps the
    readings already taken: the sandbox it ran out on, and every one not
    yet read, reads ``no-sandbox`` with the timeout detail, and the worst
    case is taken over them all (an ``expired`` read first stays
    ``expired``)."""
    try:
        return _read_logins(sandboxes, run, now, daemon_checked, deadline)
    except _Spent as spent:
        return _spent(spent, deadline, sandboxes=[])


def _spent(spent: _Spent, deadline: Deadline, **extra) -> dict:
    return _one(NO_SANDBOX, f"the sandbox login read ran out of its "
                f"{deadline.seconds:g} s budget (timed out at "
                f"`{spent}`): the sandbox login is not read",
                "check that `sbx daemon status` and `sbx ls` answer "
                "promptly, then read it again", **extra)


def _read_logins(sandboxes: list[str], run, now: float,
                 daemon_checked: bool, deadline: Deadline | None) -> dict:
    if not sandboxes:
        return _one(NO_SANDBOX, "no engine sandbox configured "
                    "(TK_SUPERVISOR_CONFIG names no jobs.*.sandbox)",
                    FIX_NO_CONFIG, sandboxes=[])
    if not daemon_checked:
        proc, why = _call(run, ["sbx", "daemon", "status"], deadline)
        if why == "absent":
            return _one(NO_SANDBOX, "sbx not on PATH: the sandbox login "
                        "is not read", "install Docker sbx if this box runs "
                        "the sandbox tier; otherwise nothing to do",
                        sandboxes=[])
        if proc is None or proc.returncode != 0:
            shown = why or f"exit {proc.returncode}: {_out(proc)}"
            return _one(NO_SANDBOX, f"the sbx daemon is not running (sbx "
                        f"daemon status {shown}): the sandbox login is not "
                        "read", FIX_DAEMON, sandboxes=[])
    ls, why = _call(run, ["sbx", "ls"], deadline)
    if ls is None or ls.returncode != 0:
        shown = why or f"exit {ls.returncode}: {_out(ls)}"
        return _one(NO_SANDBOX, f"sbx ls failed ({shown}): the sandbox "
                    "login is not read", FIX_DAEMON, sandboxes=[])
    readings = []
    spent: _Spent | None = None
    for sandbox in sandboxes:
        if spent is not None:
            # the budget ran out on an earlier sandbox: this one is not read
            readings.append({"sandbox": sandbox,
                             **_spent(spent, deadline)})
            continue
        line = _listed(ls.stdout or "", sandbox)
        if line is None or "running" not in line.lower().split():
            state = "not listed" if line is None else f"listed as {line!r}"
            reading = _one(NO_SANDBOX, f"the sandbox is not running (sbx "
                           f"ls: {state}); a stopped sandbox is never "
                           "sbx exec'd", f"nothing to do until the "
                           f"supervisor's pin starts it (sbx run -d --name "
                           f"{sandbox}); read it again once it runs")
        else:
            try:
                reading = _read_one(sandbox, run, now, deadline)
            except _Spent as exc:
                # keep the readings already taken; this sandbox (and every
                # one after it) reads no-sandbox with the timeout detail
                spent = exc
                reading = _spent(spent, deadline)
        readings.append({"sandbox": sandbox, **reading})
    worst = min(readings, key=lambda r: _ORDER.index(r["case"]))
    fixes = []
    for r in readings:
        if r["case"] == worst["case"] and r["fix"] and r["fix"] not in fixes:
            fixes.append(r["fix"])
    detail = "; ".join(f"{r['sandbox']}: {r['detail']}" for r in readings)
    return _one(worst["case"], detail, "; ".join(fixes) or None,
                sandboxes=readings)
