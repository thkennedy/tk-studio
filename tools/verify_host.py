"""tk-studio's host verify entry point (supervisor Story 27.4, `verify.host` in .tk-studio/config.yaml).

The supervisor runs one command line on the Windows host in a run's worktree, argv only, never a
shell, so the host gates (the lib suite and the conformance run, in two directories, the supervisor's
suites, Story 33.4, and the studio web's build and tests, Story 30.1) live behind this single script. It
runs them in turn with subprocess (argv only), in the order lib suite, conformance, supervisor,
studio-web, prints each gate's result as it ends, repeats every failing gate's output tail last, and
exits non-zero when any failed.

The supervisor and studio-web gates run only when their app (apps/supervisor, apps/studio-web) changed
since the merge base with `main` (else `origin/main`), uncommitted and untracked edits included; each
prints one skip line with the reason when unchanged, and runs anyway, saying why, when the base or git
is unavailable.

The studio-web gate is `bun run verify` in apps/studio-web. The supervisor gate (holes 51, 56, 63, 64)
runs every apps/supervisor/test/*.test.ts but the e2e suite (command-line.test.ts) in its own
`bun test --timeout 30000 <file>` (Story 37.2: the per-test figure on the command, DW-155), each under a 420 s timeout (the tree killed past it),
then (Story 38.6, DW-167) the e2e suite in its own step, `bun test --timeout 30000 ./test/command-line.test.ts` under a
1800 s timeout with the same environment, printing the same per-file line (one
`== supervisor: test/command-line.test.ts skip: e2e suite absent` line when the file is absent), with every TK_SUPERVISOR_*, TK_ATLASSIAN_* and TK_STUDIO_ATLASSIAN_*
variable stripped from the environment and TMPDIR/TEMP/TMP at a per-run folder
`<tempfile.gettempdir()>/tk-verify-supervisor-<UTC stamp>-<pid>/` (the gate's own temp folder, outside
any git checkout: the suites' queues refuse a path inside one, and the gate fails before the first file
when an ancestor of the folder holds `.git`) that it removes afterwards, read-only files included (a
removal that fails fails the gate); then `bunx tsc --noEmit -p apps/supervisor` from the root (`bun x tsc` when bunx
cannot start), which still type-checks the e2e suite, with apps/supervisor/node_modules/.bin first on PATH so
bunx runs the app's own installed TypeScript (the root has no node_modules: bunx would download the latest). It prints one line per file with its pass/fail
counts, the tsc line, and a closing line with the totals and the slowest file. A file that cannot start
counts as failed (rc 127); past its timeout the file's process tree is killed (its process group on
POSIX).

Story 38.1 (DW-174): the script ends with one `== durations: <suite>=<N>s, …` line (the suites that ran, in run order,
integer seconds) immediately before its final `verify_host: ok|FAILED (…)` line; the host leg records it as
`suite_durations` on its `host-verify` event. Before the first gate it reads the supervisor's queue read-only
(`queue.db` at TK_SUPERVISOR_DB, opened `file:<path>?mode=ro`): while a host leg is live on this box (a run's latest
`host-verify-leg` lease with a non-null owner and no later `host-verify`: a re-run, or a run in its close-out; DW-184:
and either no `deadline`, a lease written before it, or a `deadline` still ahead, so a crashed serve's lease goes stale
one guard after it was taken; an unparsable `deadline` reads as none) it refuses to start, exit 2, naming the lease's
run id and the remedy (hole 113: two gates on one box halve each other); `--beside-leg` runs anyway after a printed
warning, and sets TK_VERIFY_BESIDE_LEG=1 for its gates' children (DW-195: the supervisor's test preload then lets
their `bun test` run beside the leg). No queue (the variable unset, or its file absent) is no check; an
unreadable one prints one line and the gates run. The leg's own run (TK_SUPERVISOR_HOST_LEG set) never reads it.

Usage: uv run python tools/verify_host.py [--tail N] [--beside-leg]
"""
from __future__ import annotations

import argparse
import os
import re
import json
import shutil
import signal
import sqlite3
import stat
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timedelta, timezone

# The console may be cp1252 (the supervisor's host leg on Windows); bun's output carries arrows and ticks.
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8", errors="replace")
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PLUGIN = ROOT / "plugins" / "tk-studio"

GATES = (
    ("lib suite", PLUGIN / "lib", ["uv", "run", "python", "-m", "unittest", "discover", "tests"]),
    ("conformance", PLUGIN, ["uv", "run", "python", "contracts/conformance/runner.py", "run"]),
)
STUDIO_WEB = ROOT / "apps" / "studio-web"
STUDIO_WEB_GATE = ("studio-web", STUDIO_WEB, ["bun", "run", "verify"])
GIT_TIMEOUT = 60

SUPERVISOR = ROOT / "apps" / "supervisor"
SUPERVISOR_GATE = "supervisor"
SUPERVISOR_E2E = "command-line.test.ts"  # spawns `bun src/cli.ts`; Story 38.6 (DW-167): its own step, after the files
SUPERVISOR_FILE_TIMEOUT = 420
SUPERVISOR_E2E_TIMEOUT = 1800  # Story 38.6: the e2e suite's bound (its per-test bounds run to 240 s; ~96 tests)
# Story 37.2 (DW-155, hole 108): the per-test timeout on every file's command, the preload's figure; equal to the
# conformance `_budget.HOST_TEST_TIMEOUT_MS` (pinned by test_verify_host.py; no cross-tree import).
SUPERVISOR_TEST_TIMEOUT_MS = 30_000
SUPERVISOR_INSTALL_TIMEOUT = 300  # hole 80: `bun install --frozen-lockfile` when a fresh worktree has no node_modules
SUPERVISOR_ENV_PREFIXES = ("TK_SUPERVISOR_", "TK_ATLASSIAN_", "TK_STUDIO_ATLASSIAN_")  # the box's seats never shape a test
TEMP_PREFIX = "tk-verify-supervisor"
TSC_ARGV = (["bunx", "tsc", "--noEmit", "-p", "apps/supervisor"], ["bun", "x", "tsc", "--noEmit", "-p", "apps/supervisor"])
REMOVE_TRIES = 3
REMOVE_WAIT_S = 1.0
DRAIN_TIMEOUT = 10  # the bound on reading what a killed tree left in the pipe

_PASS = re.compile(r"^\s*(\d+) pass\s*$", re.MULTILINE)
_FAIL = re.compile(r"^\s*(\d+) fail\s*$", re.MULTILINE)
# Story 37.6 (B8): bun's skip count, and the per-test `(skip) <describe> > <test>` lines of its default reporter
# (observed bun 1.4.3; it prints them only outside an AI-agent env, the count line always).
_SKIP = re.compile(r"^\s*(\d+) skip\s*$", re.MULTILINE)
_SKIPPED = re.compile(r"^\(skip\) (.+?)\s*$", re.MULTILINE)


def _git(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["git", *args], cwd=str(ROOT), capture_output=True, text=True, encoding="utf-8",
                          errors="replace", timeout=GIT_TIMEOUT)


def app_changed(rel: str) -> tuple[bool, str]:
    """Whether `rel` (e.g. apps/studio-web) differs from the merge base with main (else origin/main),
    working tree and untracked files included. Any git failure or no base resolves to
    (True, "<why>; running anyway"): never a silent skip."""
    try:
        base = ""
        for ref in ("main", "origin/main"):
            proc = _git("merge-base", "HEAD", ref)
            if proc.returncode == 0 and proc.stdout.strip():
                base = proc.stdout.strip()
                break
        if not base:
            return True, "no merge base with main or origin/main; running anyway"
        proc = _git("diff", "--name-only", base, "--", rel)
        if proc.returncode != 0:
            why = (proc.stderr or proc.stdout).strip().splitlines()
            return True, f"git diff failed ({why[-1] if why else f'rc={proc.returncode}'}); running anyway"
        changed = proc.stdout.strip()
        # A new, not yet committed file is no diff against the base; count it as a change too.
        proc = _git("ls-files", "--others", "--exclude-standard", "--", rel)
        if proc.returncode != 0:
            return True, f"git ls-files failed (rc={proc.returncode}); running anyway"
        changed += proc.stdout.strip()
    except (OSError, subprocess.SubprocessError) as exc:
        return True, f"git unavailable ({exc}); running anyway"
    if changed:
        return True, f"{rel} changed since {base[:12]}"
    return False, f"{rel} unchanged since {base[:12]}"


def run_gate(name: str, cwd: Path, argv: list[str]) -> tuple[int, str, float]:
    started = time.monotonic()
    try:
        proc = subprocess.run(argv, cwd=str(cwd), capture_output=True, text=True, encoding="utf-8",
                              errors="replace", env={**os.environ, "PYTHONIOENCODING": "utf-8"})
    except FileNotFoundError as exc:
        return 127, f"{name}: cannot start {argv[0]!r}: {exc}", time.monotonic() - started
    out = (proc.stdout or "") + (proc.stderr or "")
    return proc.returncode, out, time.monotonic() - started


# ------------------------------------------------------------ the supervisor gate (Story 33.4)

def supervisor_files() -> list[str]:
    """Every apps/supervisor/test/*.test.ts but the e2e suite, as `test/<name>`, sorted."""
    return sorted(f"test/{p.name}" for p in (SUPERVISOR / "test").glob("*.test.ts") if p.name != SUPERVISOR_E2E)


def supervisor_env(tmp: Path) -> dict[str, str]:
    """The host's environment without any TK_SUPERVISOR_* variable, with TMPDIR/TEMP/TMP at `tmp`
    (TMP too: Windows' GetTempPath reads it first), and TK_STUDIO_ROOT at the repo under verification
    (hole 82: the suites' end-to-end legs resolve job definitions and run lib verbs through the plugin
    at TK_STUDIO_ROOT; the box's variable names the served checkout, so a story that changes the plugin
    and tests the supervisor against the change ran against `main`'s plugin and went red)."""
    env = {k: v for k, v in os.environ.items() if not k.upper().startswith(SUPERVISOR_ENV_PREFIXES)}
    env.update({"PYTHONIOENCODING": "utf-8", "TMPDIR": str(tmp), "TEMP": str(tmp), "TMP": str(tmp),
                "TK_STUDIO_ROOT": str(ROOT)})
    return env


def _kill_tree(proc: subprocess.Popen) -> None:
    if sys.platform == "win32":
        try:
            subprocess.run(["taskkill", "/T", "/F", "/PID", str(proc.pid)], capture_output=True, timeout=GIT_TIMEOUT)
        except (OSError, subprocess.SubprocessError):
            pass
    else:
        try:
            os.killpg(proc.pid, signal.SIGKILL)  # the child leads its own session: the whole group
        except OSError:
            pass
    try:
        proc.kill()
    except OSError:
        pass


def spawn(argv: list[str], cwd: Path, env: dict[str, str], timeout: float) -> tuple[int | None, str]:
    """Run `argv` (argv only) with both streams captured; `(None, out)` when it timed out and its tree
    was killed. Raises OSError when the program cannot start. On POSIX the child leads a new session,
    so the kill reaches its grandchildren; reading what is left after the kill is bounded by
    DRAIN_TIMEOUT, so a survivor still holding the pipe cannot hold the gate. Any other exception
    raised while reading (a KeyboardInterrupt) kills the tree the same way and is raised again."""
    proc = subprocess.Popen(argv, cwd=str(cwd), env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                            stdin=subprocess.DEVNULL, text=True, encoding="utf-8", errors="replace",
                            start_new_session=sys.platform != "win32")
    try:
        out, _ = proc.communicate(timeout=timeout)
        return proc.returncode, out or ""
    except subprocess.TimeoutExpired as exc:
        _kill_tree(proc)
        try:
            out, _ = proc.communicate(timeout=DRAIN_TIMEOUT)
        except subprocess.TimeoutExpired as drained:
            out = drained.output or exc.output or ""
            if isinstance(out, bytes):
                out = out.decode("utf-8", "replace")
        return None, out or ""
    except BaseException:  # a KeyboardInterrupt mid-read: the tree must not outlive the gate's temp folder
        _kill_tree(proc)
        try:
            proc.communicate(timeout=DRAIN_TIMEOUT)
        except subprocess.TimeoutExpired:
            pass
        raise


def bun_counts(out: str) -> tuple[int | None, int | None]:
    """bun's ` <n> pass` / ` <n> fail` summary lines (the last of each); None when absent."""
    p, f = _PASS.findall(out), _FAIL.findall(out)
    return (int(p[-1]) if p else None, int(f[-1]) if f else None)


def bun_skips(out: str) -> tuple[int, list[str]]:
    """Story 37.6 (B8): bun's ` <n> skip` summary count (the last; 0 when absent) and the names of its `(skip) <name>`
    lines, in order. Only that observed line shape feeds the names; never a guessed one."""
    s = _SKIP.findall(out)
    return (int(s[-1]) if s else 0), _SKIPPED.findall(out)


def temp_base() -> Path:
    """The gate's own temp folder (tempfile.gettempdir(), from this process's TMPDIR/TEMP/TMP, which
    the gate never overrides; only the children's environment points at the per-run folder)."""
    return Path(tempfile.gettempdir())


def git_ancestor(path: Path) -> Path | None:
    """The first of `path` and its ancestors that contains `.git`, else None."""
    resolved = path.resolve()
    for folder in (resolved, *resolved.parents):
        if (folder / ".git").exists():
            return folder
    return None


def _clear_readonly(func, path, exc) -> None:
    """rmtree's error handler: a read-only file (a killed suite's fixture git objects on Windows) gets
    its write bit back and the removal is retried once; anything else is raised again."""
    error = exc[1] if isinstance(exc, tuple) else exc  # onerror passes exc_info, onexc the exception
    if func not in (os.unlink, os.remove, os.rmdir):
        raise error
    os.chmod(path, os.lstat(path).st_mode | stat.S_IWRITE)
    func(path)


def _rmtree(tmp: Path) -> None:
    if sys.version_info >= (3, 12):
        shutil.rmtree(tmp, ignore_errors=False, onexc=_clear_readonly)
    else:
        shutil.rmtree(tmp, ignore_errors=False, onerror=_clear_readonly)


def remove_tmp(tmp: Path) -> str | None:
    """Remove the per-run folder, read-only files included (retried on PermissionError).
    The error text when the folder could not be removed, else None."""
    for attempt in range(REMOVE_TRIES):
        try:
            if tmp.exists():
                _rmtree(tmp)
            return None
        except PermissionError as exc:
            if attempt == REMOVE_TRIES - 1:
                return str(exc)
            time.sleep(REMOVE_WAIT_S)
        except OSError as exc:
            return str(exc)
    return None


def run_supervisor_gate() -> tuple[int, str]:
    """Run the supervisor gate, printing its lines. `(rc, output for the failing tail)`."""
    started = time.monotonic()
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    tmp: Path | None = None
    failed = False
    tails: list[str] = []
    timings: list[tuple[str, float]] = []
    total_pass = total_fail = total_skip = 0
    files = supervisor_files()

    def refuse(message: str) -> None:
        nonlocal failed
        failed = True
        print(message, flush=True)
        tails.append(message)

    def bun_file(rel: str, timeout: int) -> None:
        """One `bun test --timeout <figure> ./<rel>` under `timeout`, its line (and named skip lines) printed, its
        timing and counts joined to the gate's; a red file fails the gate with its tail (the files and the e2e step)."""
        nonlocal failed, total_pass, total_fail, total_skip
        t0 = time.monotonic()
        try:
            rc, out = spawn(["bun", "test", "--timeout", str(SUPERVISOR_TEST_TIMEOUT_MS), f"./{rel}"], SUPERVISOR, env,
                            timeout)
        except OSError as exc:
            rc, out = 127, f"cannot start 'bun': {exc}"
        seconds = time.monotonic() - t0
        timings.append((rel, seconds))
        p, f = bun_counts(out)
        skips, skipped = bun_skips(out)
        total_pass += p or 0
        total_fail += f or 0
        total_skip += skips
        # Story 37.6 (B8): `, S skip` only when bun skipped any (skip 0 leaves the line, and 37.2's verdicts, as they were)
        skip = f", {skips} skip" if skips else ""
        line = f"== {SUPERVISOR_GATE}: {rel} {'?' if p is None else p} pass, {'?' if f is None else f} fail{skip} in {seconds:.0f}s"
        if rc is None:
            line += f" (timed out after {timeout}s)"
        elif rc != 0:
            line += f" rc={rc}"
        print(line, flush=True)
        # One named line per skipped test, never a silent skip; bun quiet (an AI-agent env) still says how many.
        for name in skipped:
            print(f"== {SUPERVISOR_GATE}: {rel} skip: {name}", flush=True)
        if skips and not skipped:
            print(f"== {SUPERVISOR_GATE}: {rel} skip: {skips} test(s), names not reported", flush=True)
        if rc != 0:
            failed = True
            tails.append(f"--- {rel}\n{out.rstrip()}")

    e2e_ran = False  # Story 38.6: the e2e step's file joins the closing line's count when it ran
    try:
        try:
            tmp = temp_base() / f"{TEMP_PREFIX}-{stamp}-{os.getpid()}"
            tmp.mkdir(parents=True)
        except OSError as exc:
            refuse(f"== {SUPERVISOR_GATE}: cannot create the temp folder {tmp or 'under the temp folder'}: {exc}")
            tmp = None
            files = []
        checkout = git_ancestor(tmp) if tmp is not None else None
        if checkout is not None:
            refuse(f"== {SUPERVISOR_GATE}: the temp folder {tmp} is inside a git checkout ({checkout}); "
                   "the suites' queues refuse it, set TMP/TEMP/TMPDIR outside any checkout")
            files = []
        if not failed and not files:  # the folder moved or the glob broke: 0 files is no pass
            refuse(f"== {SUPERVISOR_GATE}: no test/*.test.ts files under {SUPERVISOR / 'test'}")
        env = supervisor_env(tmp) if tmp is not None and not failed else {}
        if not failed and files and not (SUPERVISOR / "node_modules").is_dir():
            # Hole 80: a fresh worktree (every verify, every story whose dev session never ran `bun install`)
            # has no node_modules; the suites cannot load (`Cannot find package 'js-yaml'`) and tsc finds no
            # `bun` types. The gate installs what it needs, from the lockfile, before the first suite.
            t0 = time.monotonic()
            try:
                rc, out = spawn(["bun", "install", "--frozen-lockfile"], SUPERVISOR, env, SUPERVISOR_INSTALL_TIMEOUT)
            except OSError as exc:
                rc, out = 127, f"cannot start 'bun': {exc}"
            seconds = time.monotonic() - t0
            if rc == 0:
                print(f"== {SUPERVISOR_GATE}: bun install (node_modules absent) ok in {seconds:.0f}s", flush=True)
            else:
                shown = f"timed out after {SUPERVISOR_INSTALL_TIMEOUT}s" if rc is None else f"rc={rc}"
                refuse(f"== {SUPERVISOR_GATE}: bun install (node_modules absent) FAILED {shown} in {seconds:.0f}s")
                tails.append(f"--- bun install\n{out.rstrip()}")
                files = []
                env = {}  # no dependencies: neither the suites nor tsc can run
        for rel in files:
            bun_file(rel, SUPERVISOR_FILE_TIMEOUT)
        if env:
            # Story 38.6 (DW-167): the e2e suite under the leg, in its own step, never a silent exclusion
            e2e = f"test/{SUPERVISOR_E2E}"
            if (SUPERVISOR / e2e).is_file():
                bun_file(e2e, SUPERVISOR_E2E_TIMEOUT)
                e2e_ran = True
            else:
                print(f"== {SUPERVISOR_GATE}: {e2e} skip: e2e suite absent", flush=True)
            t0 = time.monotonic()
            rc, out = 127, ""
            # bunx finds a bin on PATH before it downloads one: the app's own TypeScript, not the latest
            bins = str(SUPERVISOR / "node_modules" / ".bin")
            tsc_env = {**env, "PATH": os.pathsep.join(p for p in (bins, env.get("PATH", "")) if p)}
            for argv in TSC_ARGV:
                try:
                    rc, out = spawn(argv, ROOT, tsc_env, SUPERVISOR_FILE_TIMEOUT)
                    break
                except OSError as exc:
                    rc, out = 127, f"cannot start {argv[0]!r}: {exc}"
            seconds = time.monotonic() - t0
            if rc == 0:
                print(f"== {SUPERVISOR_GATE}: tsc ok in {seconds:.0f}s", flush=True)
            else:
                failed = True
                shown = f"timed out after {SUPERVISOR_FILE_TIMEOUT}s" if rc is None else f"rc={rc}"
                print(f"== {SUPERVISOR_GATE}: tsc FAILED {shown} in {seconds:.0f}s", flush=True)
                tails.append(f"--- tsc\n{out.rstrip()}")
    finally:
        error = remove_tmp(tmp) if tmp is not None else None
        if error is not None:
            failed = True
            message = f"== {SUPERVISOR_GATE}: could not remove {tmp}: {error}"
            print(message, flush=True)
            tails.append(message)
    slowest = max(timings, key=lambda t: t[1]) if timings else None
    slow = f"slowest {slowest[0]} {slowest[1]:.0f}s" if slowest else "slowest none"
    print(f"== {SUPERVISOR_GATE}: {'FAILED' if failed else 'ok'} in {time.monotonic() - started:.0f}s; "
          f"{len(files) + e2e_ran} files, {total_pass} pass, {total_fail} fail{f', {total_skip} skip' if total_skip else ''}; {slow}", flush=True)
    return (1 if failed else 0), "\n".join(tails)


# ------------------------------------------------------------ the beside-leg gate (Story 38.1, hole 113)

HOST_LEG_ENV = "TK_SUPERVISOR_HOST_LEG"  # set by the supervisor's host leg on its own run (hostverify.ts)
BESIDE_LEG_ENV = "TK_VERIFY_BESIDE_LEG"  # DW-195: lets test/preload.ts run a `bun test` beside a live leg
QUEUE_ENV = "TK_SUPERVISOR_DB"  # the supervisor's configured queue path
QUEUE_TIMEOUT_S = 5
LIVE_LEGS_SQL = """
SELECT l.run_id, l.at, l.detail FROM events l
WHERE l.kind = 'host-verify-leg'
  AND l.seq = (SELECT MAX(seq) FROM events WHERE run_id = l.run_id AND kind = 'host-verify-leg')
  AND NOT EXISTS (SELECT 1 FROM events h WHERE h.run_id = l.run_id AND h.kind = 'host-verify' AND h.seq > l.seq)
"""


# The only deadline form read (src/liveleg.ts `DEADLINE_RE`, the same rule): extended ISO-8601 with an explicit `Z` or
# `+-HH:MM` offset, untrimmed; a zoneless, padded or basic-format value is no deadline.
DEADLINE_RE = re.compile(
    r"(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|([+-])(\d{2}):(\d{2}))", re.ASCII)


def lease_deadline(detail: dict) -> datetime | None:
    """DW-184: a lease's `deadline` as an aware datetime; None when absent, not in `DEADLINE_RE`'s form, or an
    impossible date/time (hour 0-23, minute and second 0-59, a real day of the month, an offset under 24h) — read as
    no deadline."""
    raw = detail.get("deadline")
    m = DEADLINE_RE.fullmatch(raw) if isinstance(raw, str) else None
    if m is None:
        return None
    y, mo, d, h, mi, s = (int(g) for g in m.group(1, 2, 3, 4, 5, 6))
    micro = int((m.group(7) or "0")[:6].ljust(6, "0"))
    try:
        if m.group(8) == "Z":
            tz = timezone.utc
        else:
            oh, om = int(m.group(10)), int(m.group(11))
            if oh > 23 or om > 59:
                return None
            sign = -1 if m.group(9) == "-" else 1
            tz = timezone(sign * timedelta(hours=oh, minutes=om))
        return datetime(y, mo, d, h, mi, s, micro, tzinfo=tz)
    except ValueError:
        return None


def live_legs(env=None, now: datetime | None = None) -> tuple[list[tuple[str, str, str]], str | None]:
    """The live host legs in the supervisor's queue, read-only: `([(run_id, by, at), …], None)`, one per run whose
    latest `host-verify-leg` lease has a non-null owner, no later `host-verify`, and either no `deadline` (a lease
    written before DW-184, or an unparsable one) or a `deadline` after `now` (default: the current time). `([], None)`
    when TK_SUPERVISOR_DB is unset or its file absent (no queue on this box); `([], "<error>")` when the queue could
    not be read. Never probes the owner's pid (on win32 `os.kill(pid, 0)` terminates the process): a crashed leg's
    lease is stale past its deadline, and one with no deadline is answered by `--beside-leg`."""
    env = os.environ if env is None else env
    now = datetime.now(timezone.utc) if now is None else now
    raw = (env.get(QUEUE_ENV) or "").strip()
    if not raw:
        return [], None
    path = Path(raw)
    if not path.is_file():
        return [], None
    conn = None
    try:
        conn = sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True, timeout=QUEUE_TIMEOUT_S)
        rows = conn.execute(LIVE_LEGS_SQL).fetchall()
        legs: list[tuple[str, str, str]] = []
        for run_id, at, detail in rows:
            d = json.loads(detail) if detail else {}
            if not isinstance(d, dict) or d.get("owner") is None:
                continue
            deadline = lease_deadline(d)
            if deadline is not None and deadline <= now:
                continue
            legs.append((str(run_id), str(d.get("by") or "re-run"), str(at)))
        return legs, None
    except (sqlite3.Error, OSError, ValueError) as exc:
        return [], str(exc) or type(exc).__name__
    finally:
        if conn is not None:
            conn.close()


def beside_leg_check(beside_leg: bool, env=None) -> int | None:
    """The beside-leg gate before the first gate: 2 (the refusal printed) while a host leg is live and `--beside-leg`
    is not given; None to run the gates (a warning printed first under `--beside-leg`, a note when the queue is
    unreadable, nothing when there is none or this is the leg's own run). DW-195: under `--beside-leg` it sets
    TK_VERIFY_BESIDE_LEG=1 in `env` (default: this process's, so every gate's child inherits it)."""
    env = os.environ if env is None else env
    if beside_leg:
        env[BESIDE_LEG_ENV] = "1"
    if env.get(HOST_LEG_ENV):
        return None
    legs, error = live_legs(env)
    if error is not None:
        print(f"verify_host: the queue at {env.get(QUEUE_ENV)} was not read ({error}); running without the beside-leg check", flush=True)
        return None
    if not legs:
        return None
    if beside_leg:
        ids = ", ".join(run_id for run_id, _, _ in legs)
        print(f"verify_host: WARNING: --beside-leg: running beside the live host leg of queue run {ids}; "
              "both gates slow each other and the leg may run out its guard (hole 113)", flush=True)
        return None
    named = "; ".join(f"queue run {run_id} (by {by}, since {at})" for run_id, by, at in legs)
    print(f"verify_host: refused: a host leg is live on this box: {named}; two gates on one box halve each other "
          f"(hole 113): wait for its host-verify event (GET /runs/{legs[0][0]}), or pass --beside-leg to run anyway", flush=True)
    return 2


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="run tk-studio's host gates (lib suite, conformance, supervisor and studio-web when changed) "
                                     "with argv only; refuses to start beside a live host leg (hole 113) unless --beside-leg; "
                                     "ends with one `== durations:` line before its verdict")
    parser.add_argument("--tail", type=int, default=40, help="lines of each failing gate's output to repeat last")
    parser.add_argument("--beside-leg", action="store_true",
                        help="run even while a host leg is live on this box (prints a warning; both gates slow each other)")
    args = parser.parse_args(argv)
    refused = beside_leg_check(args.beside_leg)
    if refused is not None:
        return refused
    failures: list[tuple[str, int, str]] = []
    ran: list[str] = []
    durations: list[tuple[str, float]] = []  # Story 38.1: each gate that ran, in run order
    for name, cwd, cmd in GATES:
        print(f"== {name}: {' '.join(cmd)}  (cwd {cwd.relative_to(ROOT)})", flush=True)
        rc, out, seconds = run_gate(name, cwd, cmd)
        verdict = "ok" if rc == 0 else f"FAILED rc={rc}"
        print(f"== {name}: {verdict} in {seconds:.0f}s", flush=True)
        ran.append(name)
        durations.append((name, seconds))
        if rc != 0:
            failures.append((name, rc, out))
    sup_changed, sup_why = app_changed("apps/supervisor")
    if sup_changed:
        print(f"== {SUPERVISOR_GATE}: {sup_why}", flush=True)
        t0 = time.monotonic()
        rc, out = run_supervisor_gate()
        durations.append((SUPERVISOR_GATE, time.monotonic() - t0))
        ran.append(SUPERVISOR_GATE)
        if rc != 0:
            failures.append((SUPERVISOR_GATE, rc, out))
    else:
        print(f"== {SUPERVISOR_GATE}: skipped ({sup_why})", flush=True)
    web_changed, why = app_changed("apps/studio-web")
    if web_changed:
        name, cwd, cmd = STUDIO_WEB_GATE
        print(f"== {name}: {why}", flush=True)
        print(f"== {name}: {' '.join(cmd)}  (cwd {cwd.relative_to(ROOT)})", flush=True)
        rc, out, seconds = run_gate(name, cwd, cmd)
        verdict = "ok" if rc == 0 else f"FAILED rc={rc}"
        print(f"== {name}: {verdict} in {seconds:.0f}s", flush=True)
        ran.append(name)
        durations.append((name, seconds))
        if rc != 0:
            failures.append((name, rc, out))
    else:
        print(f"== {STUDIO_WEB_GATE[0]}: skipped ({why})", flush=True)
    # Story 38.1: one summary line, immediately before the verdict (after every failure tail).
    summary = f"== durations: {', '.join(f'{name}={seconds:.0f}s' for name, seconds in durations)}"
    if not failures:
        print(summary)
        print(f"verify_host: ok ({', '.join(ran)})")
        return 0
    for name, rc, out in failures:
        tail = out.rstrip().splitlines()[-args.tail:]
        print(f"\n== {name} failed (rc={rc}); last {len(tail)} lines:")
        print("\n".join(tail))
    print(f"\n{summary}")
    print(f"verify_host: FAILED ({', '.join(n for n, _, _ in failures)})")
    return 1


if __name__ == "__main__":
    sys.exit(main())
